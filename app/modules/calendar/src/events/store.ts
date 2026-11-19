// SPDX-License-Identifier: AGPL-3.0-only
import type { ChangeRow, EventRow } from '../types';
import type { ColumnPatch } from './validate';

/**
 * 日程的数据库操作（A-2）。
 *
 * D1 没有 BEGIN/COMMIT：并发安全靠「带版本号的条件 UPDATE」，`meta.changes` 为 0 就说明
 * 有人先改了或已经不在了。变更流水是独立 INSERT——即使它失败，主表数据仍然正确，
 * 只少一条提示记录，下次修改会补上。不为「原子」设计两段提交。
 */

/** 查一条（含软删的行，调用方自己判 deleted_at）。 */
export async function findEvent(db: D1Database, id: string): Promise<EventRow | null> {
  return await db.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first<EventRow>();
}

/**
 * 条件更新：只有 id、版本号、未删除三者同时对得上才落库。
 * @returns 受影响行数（0 = 版本冲突或记录已不存在）
 */
export async function updateEventConditional(
  db: D1Database,
  id: string,
  expectedVersion: number,
  columns: ColumnPatch[],
  updatedAt: number,
): Promise<number> {
  if (columns.length === 0) {
    return 0;
  }
  // 列名来自 validate 的白名单映射，不是用户输入；这里是唯一的 SQL 拼接点
  const setClause = columns.map(({ column }) => `${column} = ?`).join(', ');
  const values = columns.map(({ value }) => value);
  const result = await db
    .prepare(
      `UPDATE calendar_events
          SET ${setClause}, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ? AND deleted_at IS NULL`,
    )
    .bind(...values, updatedAt, id, expectedVersion)
    .run();
  return result.meta.changes ?? 0;
}

/** 写一条变更记录（独立 INSERT，失败不回滚主表）。 */
export async function insertChange(
  db: D1Database,
  change: {
    id: string;
    eventId: string;
    actorId: string;
    actorName: string;
    fromVersion: number;
    toVersion: number;
    changedFields: string[];
  },
  now: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO calendar_event_changes
        (id, event_id, actor_id, actor_name, from_version, to_version, changed_fields, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      change.id,
      change.eventId,
      change.actorId,
      change.actorName,
      change.fromVersion,
      change.toVersion,
      JSON.stringify(change.changedFields),
      now,
    )
    .run();
}

/**
 * 变更流：since 之后（含当毫秒）的流水，排除自己刚改的那条。
 * 用 `>=` 是为了不漏同一毫秒里的多条记录；重复的尾巴由前端按 eventId 去重（硬约定第 4 条）。
 */
export async function listChanges(
  db: D1Database,
  since: number,
  excludeEventId: string | null,
  limit: number,
): Promise<ChangeRow[]> {
  if (excludeEventId) {
    const result = await db
      .prepare(
        `SELECT * FROM calendar_event_changes
          WHERE created_at >= ? AND event_id != ?
          ORDER BY created_at ASC, id ASC
          LIMIT ?`,
      )
      .bind(since, excludeEventId, limit)
      .all<ChangeRow>();
    return result.results;
  }
  const result = await db
    .prepare(
      `SELECT * FROM calendar_event_changes
        WHERE created_at >= ?
        ORDER BY created_at ASC, id ASC
        LIMIT ?`,
    )
    .bind(since, limit)
    .all<ChangeRow>();
  return result.results;
}
