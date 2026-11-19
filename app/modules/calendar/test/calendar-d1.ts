// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

/**
 * 日历模块的最小 D1 适配器 + 迁移加载器（真 node:sqlite，零新依赖）。
 *
 * 为什么不直接 import workbench 的 test-factory：跨包 import 会把那份测试代码拉进本包的
 * tsc 编译上下文，node:sqlite 的 SQLInputValue 与 @cloudflare/workers-types 的 D1 声明
 * 不同源，类型直接对不上（chat 也是因此 fork 了自己的工厂）。实现思路抄自
 * app/workbench/test/test-factory.ts（本仓 AGPL 代码），只保留 prepare/bind/first/all/run。
 *
 * 为什么不用手搓假 D1（docs/testing.md 禁项 / #60）：假替身按字符串匹配解释 SQL，
 * 漏 WHERE、引用幻影列、语义写偏都能全绿；真 SQLite 加载真迁移后这类问题当场抛错。
 *
 * 适配器对齐真 D1 语义：all() 回 { results, success, meta }，run() 回 meta.changes/last_row_id，
 * first() 无行回 null 且支持 first('col') 单列，行是普通对象（非 null 原型）。
 */

// 不用 new URL(...)：@cloudflare/workers-types 的 URL 与 node:url 的 URL 声明不同源，
// 跨过去会报「URL is not assignable」。dirname + join 走纯字符串路径。
export const CALENDAR_MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  'calendar',
);

export function applyMigrations(sqlite: DatabaseSync, dir: string): string[] {
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    sqlite.exec(readFileSync(join(dir, file), 'utf8'));
  }
  return files;
}

type Bindable = string | number | null;

interface D1Meta {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
}

interface D1ResultShape<T> {
  results: T[];
  success: boolean;
  meta: D1Meta & Record<string, unknown>;
}

function d1Meta(changes: number, lastRowId: number): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

class SqliteD1Statement {
  private params: Bindable[] = [];

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: Bindable[]): this {
    this.params = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.params);
    if (row === undefined) {
      return null;
    }
    if (colName !== undefined) {
      return (row[colName] as T) ?? null;
    }
    return { ...row } as T;
  }

  async all<T = unknown>(): Promise<D1ResultShape<T>> {
    const rows = this.sqlite
      .prepare(this.sql)
      .all(...this.params)
      .map((row) => ({ ...row })) as T[];
    return { results: rows, success: true, meta: d1Meta(0, 0) };
  }

  async run<T = unknown>(): Promise<D1ResultShape<T>> {
    const statement = this.sqlite.prepare(this.sql);
    const result = statement.run(...this.params);
    const changes = Number(result.changes);
    return {
      results: [] as T[],
      success: true,
      meta: d1Meta(changes, Number(result.lastInsertRowid)),
    };
  }
}

/** 把真 SQLite 包成模块代码能用的 D1Database 面（只实现用到的方法）。 */
export function createD1Adapter(sqlite: DatabaseSync): D1Database {
  return {
    prepare: (sql: string) => new SqliteD1Statement(sqlite, sql),
  } as unknown as D1Database;
}
