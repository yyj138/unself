# 日历模块跨组字段口径

增、查、改、删四组共用一个模块、一张表。这份文档定死四组之间的字段与写入规则，各组实现按它走，避免后面四份 PR 互相改表。

## 一、命名

两套名字各管一段，任何一侧不许透出另一侧的名字。

- 数据库列名：snake_case，例如 `start_at`、`end_at`、`all_day`。
- 对外 API 与前端：camelCase，例如 `startAt`、`endAt`、`allDay`。
- 表行转对外形状统一用 `src/types.ts` 的 `rowToEvent()`，不要各组自己拼对象。

时间一律存 UTC 毫秒整数（`INTEGER`）。时区单独存 IANA 名（`Asia/Shanghai`），不存本地时间字符串。`all_day` 在库里是 `0` / `1`，出到 API 是布尔。

## 二、表与迁移

- 表名以 `calendar_` 开头，这是 `docs/modules.md` 第 6 节第 3 条的硬要求。
- 现有两张表：`calendar_events`（主表）、`calendar_event_changes`（变更流水）。
- 迁移目录 `migrations/calendar/`，文件名 `000N_描述.sql`，只增不改；`CREATE TABLE` 与 `CREATE INDEX` 必须带 `IF NOT EXISTS`。
- 已有迁移 `0001_events.sql`。需要加列就新开 `0002_xxx.sql`，不要改 0001。

## 三、version

`version` 是乐观锁令牌，也是 iCalendar 的 SEQUENCE 语义。

- 新建时写入 `version = 1`，同时写一条流水：`from_version = 0`、`to_version = 1`。前端靠 `from_version = 0` 识别这条是创建。
- 每一次成功写入（改、软删）都 `version = version + 1`，一次加一，不许跳号。
- 条件更新必须一条语句同时完成判定与写入：

```sql
UPDATE calendar_events
   SET <变更列>, version = version + 1, updated_at = ?
 WHERE id = ? AND version = ? AND deleted_at IS NULL
```

`meta.changes` 为 0 就是冲突或记录已不在，不要再读一次去比对，直接按冲突处理。

- 改接口收到旧版本返回 409，带当前 `event` 与真实 `version`。软删收到旧版本同样返回 409，口径一致。
- 业务字段没有任何实际变化时不落库、不加版本、不写流水，返回 200 加当前值。

## 四、id 与 uid

- `id`：对外主键，21 位 nanoid。四组都用同一个生成方式。
- `uid`：iCalendar UID，独立一列，与 `id` 不同值，21 位 nanoid。创建时生成一次，之后任何接口都不许改（`uid` 在只读字段表里，出现在 PATCH 请求就是 400）。
- 导出 iCal 时用 `uid`，不用 `id`。`id` 只在站内路由与流水里用。

## 五、软删

删除一律软删，不做物理删除。

- 删组的写入形状：

```sql
UPDATE calendar_events
   SET deleted_at = ?, version = version + 1, updated_at = ?
 WHERE id = ? AND version = ? AND deleted_at IS NULL
```

- 软删必须写一条流水：`changed_fields = ["deletedAt"]`，`from_version` 为删除前版本，`to_version` 为删除后版本。
- `changed_fields` 用 API 字段名，所以这里写 `deletedAt`，不写 `deleted`。分工文档早期写的 `deleted` 按本条统一改为 `deletedAt`，四组一致。
- 记录已被软删后，改接口一律 404，不返回 409，前端按已删除处理。查接口不返回已软删的行。

## 六、各组写入要求

- 增组：INSERT 时 `created_at = updated_at = now`、`version = 1`、`status = confirmed`、`response_state` 留 `null`（创建人不是参与者）、`all_day` 存 0 或 1。字段长度与枚举校验复用 `src/types.ts` 的常量与 `validate.ts` 的口径，不另写一套。写完补一条创建流水。
- 查组：读同一张 `calendar_events`，按 `start_at` 区间走已有索引；输出走 `rowToEvent()`；已软删的行过滤掉。若要做关键词搜索，用 `title LIKE`，不要改动表结构。
- 删组：只写软删，按上面第五节的语句与流水。删除也要带 `version`，缺版本按 400 处理，旧版本按 409 处理。
- 改组：只动 `EDITABLE_FIELDS` 里的字段，`id`、`uid`、`organizerId`、`createdAt`、`updatedAt`、`deletedAt` 出现在请求体一律 400。

## 七、共用位置

- 字段常量、枚举、错误体、`rowToEvent()`：`app/modules/calendar/src/types.ts`。四组都从这里 import，不要各建一份。
- 校验与字段映射：`src/events/validate.ts`。增组做创建校验时复用它的字段与长度口径。
- 数据库操作：`src/events/store.ts`。删组可以直接用同一套写法，或在本文件里加一个 `softDeleteEventConditional()`。

## 八、需要各组确认

1. 创建流水是每条日程一条，还是合并成批量一条。建议一条日程一条，便于前端逐条提示。
2. 软删时 `changed_fields` 用 `deletedAt`（本文档口径），若某组前端已按 `deleted` 处理，需要在联调前统一。
3. 四组共用一份 `types.ts` 与 `store.ts`，各自的 PR 不要复制粘贴出第二份，冲突由先合的一方保留原文件、后合的一方只加自己的函数。
