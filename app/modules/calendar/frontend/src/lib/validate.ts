// SPDX-License-Identifier: AGPL-3.0-only
import { MAX_TITLE_LENGTH } from '../../../src/types'
import type { CalendarEvent, EventStatus } from '../../../src/types'

export interface EditableDraft {
  title: string
  description: string
  location: string
  startAt: number
  endAt: number
  status: EventStatus
}

/** 前端校验：与后端 validatePatch 同源，只做即时提示，不替代服务端校验。 */
export function validateDraft(draft: EditableDraft): string | null {
  if (!draft.title.trim()) return '标题不能为空'
  if (draft.title.trim().length > MAX_TITLE_LENGTH) return `标题最多 ${MAX_TITLE_LENGTH} 字`
  if (!Number.isInteger(draft.startAt) || !Number.isInteger(draft.endAt)) return '时间格式不对'
  if (draft.startAt >= draft.endAt) return '开始时间必须早于结束时间'
  return null
}

/** 本地草稿与服务端最新值逐字段对比，得出 409 要展示的字段。 */
export function diffEditableFields(local: EditableDraft, latest: CalendarEvent): string[] {
  const fields: string[] = []
  if (local.title !== latest.title) fields.push('title')
  if (local.startAt !== latest.startAt) fields.push('startAt')
  if (local.endAt !== latest.endAt) fields.push('endAt')
  if (local.location !== latest.location) fields.push('location')
  if ((local.description || null) !== latest.description) fields.push('description')
  if (local.status !== latest.status) fields.push('status')
  return fields
}
