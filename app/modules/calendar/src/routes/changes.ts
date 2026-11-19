// SPDX-License-Identifier: AGPL-3.0-only
import type { Context } from 'hono';
import { requireAuth, type AppEnv } from '../auth';
import { listChanges as listChangeRows } from '../events/store';
import type { EventChange } from '../types';

/**
 * 变更流（A-4）：GET /api/events/changes?since=<毫秒>&excludeEventId=<id>
 *
 * 前端每 3 秒拉一次，用返回的 cursor 推进。since 用「含当毫秒」的语义，同一毫秒里的多条
 * 记录一次全给；重复的尾巴由前端按 eventId 去重并取最大版本（硬约定第 4 条）。
 * 单次最多 200 条，够一次 3 秒窗口内所有人在同一个团队里的编辑量。
 */

const MAX_CHANGES = 200;

export async function listChanges(c: Context<AppEnv>): Promise<Response> {
  const blocked = await requireAuth(c);
  if (blocked) return blocked;

  const sinceRaw = c.req.query('since');
  let since = 0;
  if (sinceRaw !== undefined && sinceRaw !== '') {
    const parsed = Number(sinceRaw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return c.json({ error: 'since_invalid', field: 'since' }, 400);
    }
    since = parsed;
  }

  const excludeRaw = c.req.query('excludeEventId');
  const excludeEventId = excludeRaw === undefined || excludeRaw === '' ? null : excludeRaw;

  const rows = await listChangeRows(c.env.DB, since, excludeEventId, MAX_CHANGES);

  const changes: EventChange[] = rows.map((row) => ({
    eventId: row.event_id,
    actorName: row.actor_name ?? row.actor_id,
    toVersion: row.to_version,
    changedFields: parseFieldList(row.changed_fields),
    createdAt: row.created_at,
  }));

  // 游标只前进不后退：没有新记录时保持调用方传进来的 since
  const cursor = changes.length > 0 ? Math.max(since, changes[changes.length - 1]!.createdAt) : since;

  return c.json({ changes, cursor });
}

/** changed_fields 是 JSON 数组；历史行如有损坏就当成空数组，不让整条流断掉。 */
function parseFieldList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // 落到下面的空数组
  }
  return [];
}
