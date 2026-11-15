import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type Param = SQLInputValue | boolean | undefined;
export type Row = Record<string, unknown>;

function norm(params: Param[]): SQLInputValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

/** Thin typed wrapper around Node's built-in SQLite driver. */
export class Db {
  readonly raw: DatabaseSync;
  private stmts = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
    );
  }

  private stmt(sql: string) {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql).all(...norm(params)) as T[];
  }

  get<T = Row>(sql: string, ...params: Param[]): T | null {
    return (this.stmt(sql).get(...norm(params)) as T | undefined) ?? null;
  }

  run(sql: string, ...params: Param[]): { changes: number } {
    const r = this.stmt(sql).run(...norm(params));
    return { changes: Number(r.changes) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth++;
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    } finally {
      this.depth--;
    }
  }

  close(): void {
    this.stmts.clear();
    this.raw.close();
  }
}

export function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const now = (): string => new Date().toISOString();
