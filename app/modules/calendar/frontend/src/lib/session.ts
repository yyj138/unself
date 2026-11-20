// SPDX-License-Identifier: AGPL-3.0-only
import { createModuleSDK, resolveShellOrigin } from '@unself/sdk'
import type { ModuleSDK } from '@unself/sdk'

/**
 * 日历模块 SDK 会话：ready 握手 → 壳下发 token → 静默续期。
 * 精简自 chat 的 session.ts，只留日历用得到的 token 通道；token 只存内存。
 */
export interface CalendarSession {
  sdk: ModuleSDK
  getToken(): string | null
  handshake(timeoutMs?: number): Promise<void>
  dispose(): void
}

const HANDSHAKE_TIMEOUT_MS = 15_000

export function createCalendarSession(): CalendarSession {
  const sdk = createModuleSDK({
    moduleId: 'calendar',
    coreOrigin: resolveShellOrigin(),
  })

  let latestToken: string | null = null
  let waiter: ((token: string) => void) | null = null

  const adopt = (token: string): void => {
    latestToken = token
    waiter?.(token)
    waiter = null
  }

  sdk.ready()
  void sdk.waitForToken().then(adopt).catch(() => {
    /* 配置错误由 handshake 超时统一兑成人话错误 */
  })

  const handshake = (timeoutMs = HANDSHAKE_TIMEOUT_MS): Promise<void> =>
    new Promise((resolve, reject) => {
      if (latestToken !== null) {
        // 首 token 已到：补启动续期循环
        sdk.startTokenLoop(latestToken, adopt)
        resolve()
        return
      }
      const timer = setTimeout(() => {
        waiter = null
        reject(new Error('连接超时：未能从平台取得身份令牌'))
      }, timeoutMs)
      waiter = (token) => {
        clearTimeout(timer)
        // 首 token 到手：启动静默续期循环
        sdk.startTokenLoop(token, adopt)
        resolve()
      }
    })

  return {
    sdk,
    getToken: () => latestToken,
    handshake,
    dispose: () => {
      waiter = null
      sdk.stopTokenLoop()
    },
  }
}
