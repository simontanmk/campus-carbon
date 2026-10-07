import { describe, expect, it } from "vitest";
import { buildRebaseSql } from "../seed/rebase";
import { buildSeedSql } from "../seed/sql";
import { sgDayStart } from "../src/worker/lib/time";
import { createTestD1 } from "./helpers/d1";

const DAY = 86_400_000;
const seededAt = Date.UTC(2026, 8, 29, 4); // the seed ran weeks before the demo

describe("seed rebase", () => {
  it("moves each persona and their seeded history to two weeks before 'now', keeping the spacing", () => {
    const { raw } = createTestD1();
    raw.exec(buildSeedSql(seededAt));
    raw.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,created_at) VALUES ('rehearsal','u-bea','waste','container_return',5,0,'manual',${seededAt + DAY})`);
    const before = raw.prepare("SELECT id, created_at FROM activities WHERE user_id='u-alex' AND id LIKE 'seed-%' ORDER BY id").all() as any[];
    const createdBefore = (raw.prepare("SELECT created_at FROM users WHERE id='u-alex'").get() as any).created_at;

    const demoDay = seededAt + 35 * DAY;
    raw.exec(buildRebaseSql(demoDay));

    const target = sgDayStart(demoDay) - 14 * DAY;
    for (const id of ["u-alex", "u-bea", "u-chen"]) {
      expect((raw.prepare("SELECT created_at FROM users WHERE id=?").get(id) as any).created_at).toBe(target);
    }
    const after = raw.prepare("SELECT id, created_at FROM activities WHERE user_id='u-alex' AND id LIKE 'seed-%' ORDER BY id").all() as any[];
    expect(after.map((a) => a.created_at - target)).toEqual(before.map((b) => b.created_at - createdBefore));
    expect(Math.max(...after.map((a) => a.created_at))).toBeLessThan(demoDay);
    // Non-seed rows and other accounts are untouched.
    expect((raw.prepare("SELECT created_at FROM activities WHERE id='rehearsal'").get() as any).created_at).toBe(seededAt + DAY);
    expect((raw.prepare("SELECT created_at FROM users WHERE id='u-admin'").get() as any).created_at).toBe(createdBefore);
  });

  it("is a no-op when run twice the same day", () => {
    const { raw } = createTestD1();
    raw.exec(buildSeedSql(seededAt));
    const demoDay = seededAt + 35 * DAY;
    raw.exec(buildRebaseSql(demoDay));
    const once = raw.prepare("SELECT id, created_at FROM activities ORDER BY id").all();
    raw.exec(buildRebaseSql(demoDay + 3_600_000));
    expect(raw.prepare("SELECT id, created_at FROM activities ORDER BY id").all()).toEqual(once);
  });
});
