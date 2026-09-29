import { describe, expect, it } from "vitest";
import { createTestD1 } from "./helpers/d1";
import { buildSeedSql } from "../seed/sql";

function seeded() {
  const t = createTestD1();
  t.raw.exec(buildSeedSql(Date.UTC(2026, 8, 1)));
  return t;
}

describe("seed", () => {
  it("applies cleanly and is idempotent", () => {
    const { raw } = seeded();
    raw.exec(buildSeedSql(Date.UTC(2026, 8, 1)));
    expect((raw.prepare("SELECT COUNT(*) AS n FROM items").get() as any).n).toBe(14);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n).toBe(7);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM stalls").get() as any).n).toBe(3);
  });

  it("stores computed kg and low-carbon flags", () => {
    const { raw } = seeded();
    const row = (id: string) => raw.prepare("SELECT kg_co2e, low_carbon, kind FROM items WHERE id=?").get(id) as any;
    expect(row("econ-veg-egg")).toEqual({ kg_co2e: 0.65, low_carbon: 1, kind: "meal" });
    expect(row("chicken-rice")).toEqual({ kg_co2e: 1.36, low_carbon: 0, kind: "meal" });
    expect(row("beef-hor-fun")).toEqual({ kg_co2e: 5.7, low_carbon: 0, kind: "meal" });
    expect(row("kopi")).toEqual({ kg_co2e: 0.47, low_carbon: 0, kind: "drink" });
    expect(row("teh-o-kosong")).toEqual({ kg_co2e: null, low_carbon: 0, kind: "drink" });
  });

  it("seeds sourced mobility factors (kg per passenger-km)", () => {
    const { raw } = seeded();
    const f = raw.prepare("SELECT key, kg_per_unit, unit FROM factors WHERE unit='pkm' ORDER BY key").all();
    expect(f).toEqual([
      { key: "car", kg_per_unit: 0.1705, unit: "pkm" },
      { key: "shuttle", kg_per_unit: 0.0965, unit: "pkm" },
    ]);
  });

  it("seeds six campus locations with coordinates", () => {
    const { raw } = seeded();
    const rows = raw.prepare("SELECT id, lat, lon FROM locations ORDER BY id").all() as any[];
    expect(rows.map((r) => r.id)).toEqual(["canteen-2", "hall-11", "hive", "north-spine", "south-spine", "src"]);
    expect(rows.every((r) => r.lat > 1.3 && r.lat < 1.4 && r.lon > 103.6 && r.lon < 103.7)).toBe(true);
  });

  it("re-seeding keeps live edits and does not duplicate history", () => {
    const { raw } = seeded();
    raw.exec("UPDATE users SET role='admin', created_at=123 WHERE id='u-bea'");
    raw.exec("UPDATE stalls SET active=0 WHERE id='drinks'");
    raw.exec("UPDATE items SET status='draft', points=7 WHERE id='kopi'");
    raw.exec("UPDATE settings SET value='50' WHERE key='rate_daily_max'");
    raw.exec("UPDATE factors SET kg_per_unit=999 WHERE key='rice'");
    const before = (raw.prepare("SELECT COUNT(*) AS n FROM activities").get() as any).n;
    raw.exec(buildSeedSql(Date.UTC(2026, 9, 20)));
    expect(raw.prepare("SELECT role, created_at FROM users WHERE id='u-bea'").get()).toEqual({ role: "admin", created_at: 123 });
    expect((raw.prepare("SELECT active FROM stalls WHERE id='drinks'").get() as any).active).toBe(0);
    expect(raw.prepare("SELECT status, points FROM items WHERE id='kopi'").get()).toEqual({ status: "draft", points: 7 });
    expect((raw.prepare("SELECT value FROM settings WHERE key='rate_daily_max'").get() as any).value).toBe("50");
    expect((raw.prepare("SELECT kg_per_unit FROM factors WHERE key='rice'").get() as any).kg_per_unit).toBe(4.45);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM activities").get() as any).n).toBe(before);
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("gives each persona a baseline week and a last week, anchored to their created_at", () => {
    const { raw } = seeded();
    const DAY = 86_400_000;
    for (const id of ["u-alex", "u-bea", "u-chen"]) {
      const created = (raw.prepare("SELECT created_at FROM users WHERE id=?").get(id) as any).created_at;
      const rows = raw.prepare("SELECT created_at, kg_co2e FROM activities WHERE user_id=?").all(id) as any[];
      const firstWeek = rows.filter((r) => r.created_at >= created && r.created_at < created + 7 * DAY);
      const secondWeek = rows.filter((r) => r.created_at >= created + 7 * DAY && r.created_at < created + 14 * DAY);
      expect(firstWeek.length).toBeGreaterThan(3);
      expect(secondWeek.length).toBeGreaterThan(3);
    }
  });

  it("Alex's baseline is heavier than Chen's", () => {
    const { raw } = seeded();
    const kg = (id: string) => (raw.prepare("SELECT SUM(kg_co2e) AS k FROM activities WHERE user_id=?").get(id) as any).k;
    expect(kg("u-alex")).toBeGreaterThan(kg("u-chen") * 2);
  });

  it("links sellers to stalls and back-dates accounts 14 days", () => {
    const { raw } = seeded();
    const u = raw.prepare("SELECT stall_id, created_at FROM users WHERE id='u-seller-econ'").get() as any;
    expect(u.stall_id).toBe("econ-rice");
    expect(u.created_at).toBe(Date.UTC(2026, 8, 1) - 14 * 86_400_000);
  });

  it("escapes single quotes in text", () => {
    const { raw } = seeded();
    raw.exec(buildSeedSql().replaceAll("'Demo Canteen'", "'Demo''s Canteen'"));
    expect((raw.prepare("SELECT canteen FROM stalls WHERE id='drinks'").get() as any).canteen).toBe("Demo's Canteen");
  });
});
