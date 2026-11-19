// SPDX-License-Identifier: AGPL-3.0-only
import type { Context } from 'hono';
import { requireAuth, type AppEnv } from '../auth';

/**
 * 变更流（A-4）：GET /api/events/changes?since=&excludeEventId=
 * 前端每 3 秒拉一次，游标推进；命中正在编辑的那条就提示「已被他人修改」。
 */
export async function listChanges(c: Context<AppEnv>): Promise<Response> {
  const blocked = await requireAuth(c);
  if (blocked) return blocked;
  return c.json({ error: 'not_implemented' }, 501);
}
