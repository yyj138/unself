// SPDX-License-Identifier: AGPL-3.0-only
import type { Context } from 'hono';
import { requireAuth, type AppEnv } from '../auth';
import { findEvent, insertChange, updateEventConditional } from '../events/store';
import { validatePatch } from '../events/validate';
import { rowToEvent } from '../types';

/**
 * 日程接口（A-3）。
 *
 * PATCH 的判定顺序是固定的：验 token → 查记录（已删除的一律 404）→ 判组织者 → 校验
 * → 带版本号的条件更新 → 写变更记录。顺序不能调：先判组织者再校验，否则非组织者能从
 * 400 与 409 的差别里探出别人日程的字段内容。
 */

/** 21 位随机 id（变更流水用；事件 id 由增组写入，模块不生成）。 */
function newChangeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 21);
}

export async function patchEvent(c: Context<AppEnv>): Promise<Response> {
  const blocked = await requireAuth(c);
  if (blocked) return blocked;
  const claims = c.get('claims');
  const id = c.req.param('id') ?? '';

  const row = await findEvent(c.env.DB, id);
  if (!row || row.deleted_at !== null) {
    return c.json({ error: 'not_found' }, 404);
  }
  if (row.organizer_id !== claims.sub) {
    return c.json({ error: 'forbidden' }, 403);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'body_must_be_json' }, 400);
  }

  const result = validatePatch(raw, row);
  if (!result.ok) {
    return result.field === undefined
      ? c.json({ error: result.error }, 400)
      : c.json({ error: result.error, field: result.field }, 400);
  }

  const before = rowToEvent(row);

  // 业务字段没有变化：不写库、不写流水，直接回当前值（幂等）
  if (result.changedFields.length === 0) {
    return c.json({ event: before, version: before.version });
  }

  const now = Date.now();
  const changed = await updateEventConditional(
    c.env.DB,
    row.id,
    result.patch.version,
    result.columns,
    now,
  );

  if (changed === 0) {
    // 版本对不上或已被删除：重新查一次区分 404 与 409
    const latest = await findEvent(c.env.DB, id);
    if (!latest || latest.deleted_at !== null) {
      return c.json({ error: 'not_found' }, 404);
    }
    const event = rowToEvent(latest);
    return c.json({ error: 'version_conflict', event, version: event.version }, 409);
  }

  // 变更记录是独立 INSERT：写失败也不影响主表正确性，只少一条提示记录
  try {
    await insertChange(
      c.env.DB,
      {
        id: newChangeId(),
        eventId: row.id,
        actorId: claims.sub,
        actorName: claims.name ?? claims.sub,
        fromVersion: before.version,
        toVersion: before.version + 1,
        changedFields: result.changedFields,
      },
      now,
    );
  } catch {
    // 有意留空：下一次修改会写入新的记录
  }

  const updated = await findEvent(c.env.DB, id);
  const event = updated ? rowToEvent(updated) : { ...result.next, version: before.version + 1, updatedAt: now };
  return c.json({ event, version: event.version });
}

/**
 * 只读详情：查组交付前的自测通道（联调时删）。
 * 已删除的记录与非组织者都按 404 / 403 处理，口径与 PATCH 一致。
 */
export async function getEvent(c: Context<AppEnv>): Promise<Response> {
  const blocked = await requireAuth(c);
  if (blocked) return blocked;
  const id = c.req.param('id') ?? '';

  const row = await findEvent(c.env.DB, id);
  if (!row || row.deleted_at !== null) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ event: rowToEvent(row) });
}
