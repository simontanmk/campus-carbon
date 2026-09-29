import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

type Row = Record<string, unknown>;

function plain(row: unknown): Row | null {
  return row == null ? null : { ...(row as Row) };
}

// Real D1 answers over the network; yielding here lets concurrent requests interleave like they would live.
const tick = () => new Promise((r) => setImmediate(r));

function statement(db: DatabaseSync, sql: string, params: unknown[] = []): any {
  return {
    bind: (...p: unknown[]) => statement(db, sql, p),
    first: async (col?: string) => {
      await tick();
      const row = plain(db.prepare(sql).get(...(params as any[])));
      if (row && col) return row[col];
      return row;
    },
    all: async () => (await tick(), {
      results: db.prepare(sql).all(...(params as any[])).map((r) => plain(r)!),
      success: true,
      meta: {},
    }),
    run: async () => {
      await tick();
      const r = db.prepare(sql).run(...(params as any[]));
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  };
}

export function wrapD1(db: DatabaseSync): any {
  return {
    prepare: (sql: string) => statement(db, sql),
    batch: async (stmts: any[]) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
}

export function createTestD1() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) raw.exec(readFileSync(`migrations/${f}`, "utf8"));
  return { d1: wrapD1(raw), raw };
}
