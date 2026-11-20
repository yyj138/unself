// SPDX-License-Identifier: AGPL-3.0-only
import { onMounted, onUnmounted, ref } from 'vue'
import type { EventChange } from '../../../src/types'
import { AuthExpiredError, fetchChanges } from './api'

const POLL_INTERVAL = 3000

/**
 * 每 3 秒拉一次变更流，游标推进、按 eventId 去重；切后台暂停，切回补拉一次。
 * 不传 excludeEventId（它会连别人改同一条的提示一起排掉），改为按 toVersion 与本地 version 比较过滤自己。
 */
export function useEventChanges(options: {
  eventId: string
  getVersion: () => number
  onHit: (change: EventChange) => void
  onAuthExpired: () => void
}) {
  const cursor = ref(0)
  const latestByEvent = new Map<string, number>()
  let timer: ReturnType<typeof setInterval> | undefined

  async function poll(): Promise<void> {
    try {
      const { changes, cursor: next } = await fetchChanges(cursor.value)
      cursor.value = next
      for (const change of changes) {
        // 去重：同一 event 只提示版本最大的那条
        const seen = latestByEvent.get(change.eventId) ?? 0
        if (change.toVersion <= seen) continue
        latestByEvent.set(change.eventId, change.toVersion)
        // TODO(做日程列表时再处理)：其它日程的变更在这里被丢弃，但 cursor 已推进，届时会漏
        if (change.eventId !== options.eventId) continue
        // 自己保存产生的变更，版本号不比本地新，不提示（等价于 excludeEventId 的目的）
        if (change.toVersion <= options.getVersion()) continue
        options.onHit(change)
      }
    } catch (err) {
      // 401 交给界面提示，其余错误（网络抖动、5xx）忽略，下一轮再试
      if (err instanceof AuthExpiredError) options.onAuthExpired()
    }
  }

  function start(): void {
    if (timer !== undefined) return
    timer = setInterval(() => void poll(), POLL_INTERVAL)
  }

  function stop(): void {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }

  function onVisibility(): void {
    if (document.hidden) stop()
    else {
      void poll()
      start()
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibility)
    if (!document.hidden) start()
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    stop()
  })

  return { poll }
}
