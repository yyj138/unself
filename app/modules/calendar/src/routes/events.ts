// SPDX-License-Identifier: AGPL-3.0-only
import type { Context } from 'hono';
import { requireAuth, type AppEnv } from '../auth';

/**
 * 日程接口（A-3 落 PATCH；只读 GET 是联调前的自测通道，查组交付后删）。
 * 认证收口在 requireAuth，这里只做业务。
 */

export async function patchEvent(c: Context<AppEnv>): Promise<Response> {
  const blocked = await requireAuth(c);
  if (blocked) return blocked;
  // A-2/A-3：校验 → 判组织者 → 条件更新 → 变更记录
  return c.json({ error: 'not_implemented' }, 501);
}

export async function getEvent(c: Context<AppEnv>): Promise<Response> {
  const blocked = await requireAuth(c);
  if (blocked) return blocked;
  return c.json({ error: 'not_implemented' }, 501);
}
