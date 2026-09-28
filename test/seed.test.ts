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

  it("seeds mobility factors as pending (null)", () => {
    const { raw } = seeded();
    const f = raw.prepare("SELECT kg_per_unit FROM factors WHERE key IN ('shuttle','car')").all() as any[];
    expect(f.map((r) => r.kg_per_unit)).toEqual([null, null]);
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
