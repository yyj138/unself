# 日历模块存储方案

## 结论

calendar 模块采用：`storage: core` 加 `tables` 申报，迁移放 `migrations/calendar/`，业务代码直连模块专属 D1。不采用 `permissions: storage` 的 Core API 键值代理。

## 依据

1. `docs/modules.md` 第 5 节：`core` 落点分两块，键值走 Core API，自建表就在 `tables` 里申报。
2. `docs/modules.md` 第 6 节：申报 `tables` 的模块用 `migrations/<模块id>/` 目录，表名以 `<模块id>_` 开头，逐条幂等，`CREATE TABLE` 与 `CREATE INDEX` 带 `IF NOT EXISTS`，迁移只增不改。
3. Core API 的存储端点只有 `GET` / `PUT` / `DELETE` / 列键四个形状，文档写明不承诺关系表（决策 #55）。键值代理既没有条件更新，也没有 CAS。
4. 改功能的核心是乐观锁：必须一条 `UPDATE ... WHERE id = ? AND version = ? AND deleted_at IS NULL` 同时完成判定与写入，`meta.changes` 为 0 即冲突。键值代理只能先读后写，两人同时保存会互相覆盖，谁赢无法判定，409 冲突也就无从产生。
5. 变更流需要按 `created_at` 范围查询并排除某个 `eventId`。键值代理只能 list 全部键再逐个读，数据量增长后线性退化。
6. 仓库内两种形态各有先例：chat 申报 `tables` 并用 `migrations/<模块id>/` 目录（存量模块，表名沿用旧名未加前缀）；hello 不建表，只走 Core API 键值。有自建表与并发语义需求的模块走前者。

## 与上游 PR #367 的差异

- #367（cilu210）在 `app/modules/calendar` 用 `permissions: storage` 加键值 blob，事件存成 `event_<id>` 的 JSON，没有 `migrations/` 目录。
- 具体差异：
  - 存储形态：键值代理对比专属 D1 加迁移。
  - 事件字段：他们用 `start_time` / `end_time` 字符串，我们用 `startAt` / `endAt` UTC 毫秒整数。
  - 并发：我方用 `version` 做乐观锁，冲突返回 409 并带当前值。
- 建议：保留 #367 的 Docker 与 Node 运行方式、模块页骨架，calendar 的事件读写改为直连 D1；两份 `src/index.ts` 只能留一份，整合责任由双方确认后指定。

## 表清单

- `calendar_events`：日程主表，含 `version` 与 `deleted_at`。
- `calendar_event_changes`：变更流水，含 `changed_fields` JSON 数组。
- 迁移文件：`app/modules/calendar/migrations/calendar/0001_events.sql`。
