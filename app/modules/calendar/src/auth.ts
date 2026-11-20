// SPDX-License-Identifier: AGPL-3.0-only
import type { Context } from 'hono';
import type { ModuleTokenClaims } from '@unself/contracts';
import { verifyModuleToken } from '@unself/sdk';

/** 模块 id：aud 锁定 + 表名前缀 + manifest 三处一致。 */
export const MODULE_ID = 'calendar';

export interface Bindings {
  /** 专属 D1（装配期接线）。 */
  DB: D1Database;
  /** Core 公钥 JWKS 的 JSON 序列化（部署期注入，模块本地验签，零运行时网络）。 */
  CORE_JWKS_JSON?: string;
  /** Core issuer（可选；非空时额外校验 iss）。 */
  CORE_ISSUER?: string;
  /** 实例 id 即 aud（可选；部署者改过实例名时注入，缺省用 manifest.id）。 */
  CORE_AUDIENCE?: string;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: { claims: ModuleTokenClaims };
};

/**
 * 全模块唯一的认证收口：业务接口与 /life/* 都走这里。
 * 缺 JWKS 说明装配没注入（503），token 验不过或 aud 不是 calendar 都是 401。
 */
export async function requireAuth(c: Context<AppEnv>): Promise<Response | null> {
  const auth = c.req.header('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'missing bearer token' }, 401);
  }
  const coreJwksJson = c.env.CORE_JWKS_JSON;
  if (!coreJwksJson) {
    return c.json({ error: 'jwks not provisioned' }, 503);
  }
  try {
    const claims = await verifyModuleToken(auth.slice(7), {
      coreJwksJson,
      // aud 是实例 id，部署者可以改；缺省按 manifest.id（MODULE_ID）
      audience: c.env.CORE_AUDIENCE ?? MODULE_ID,
    });
    // SDK 只校验 audience，iss 在模块侧补：配了 CORE_ISSUER 就必须对上
    if (c.env.CORE_ISSUER && claims.iss !== c.env.CORE_ISSUER) {
      return c.json({ error: 'token invalid or expired' }, 401);
    }
    c.set('claims', claims);
    return null;
  } catch {
    return c.json({ error: 'token invalid or expired' }, 401);
  }
}
