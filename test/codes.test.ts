import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, newCode, normalizeCode } from "../src/worker/lib/codes";
import { setup } from "./helpers/setup";

describe("codes", () => {
  it("makes 6-character codes from the unambiguous alphabet", () => {
    const codes = Array.from({ length: 200 }, newCode);
    for (const c of codes) expect(c).toMatch(new RegExp(`^[${CODE_ALPHABET}]{6}$`));
    expect(new Set(codes).size).toBeGreaterThan(195);
    expect(CODE_ALPHABET).not.toMatch(/[ILO01]/);
  });

  it.each([
    ["k7p-q2m", "K7PQ2M"],
    [" K7P Q2M ", "K7PQ2M"],
    ["K7PQ2M", "K7PQ2M"],
  ])("normalises %j", (input, out) => {
    expect(normalizeCode(input)).toBe(out);
  });

  it.each([["K7PQ2"], ["K7PQ2MX"], ["O0I1LQ"], [123], [null]])("rejects %j", (input) => {
    expect(normalizeCode(input)).toBeNull();
  });
});

describe("rewards schema and seed", () => {
  it("seeds three demo rewards", async () => {
    const { raw } = await setup();
    expect(raw.prepare("SELECT id, cost, stall_id, weekly_stock, active FROM rewards ORDER BY cost").all()).toEqual([
      { id: "egg-addon", cost: 80, stall_id: "econ-rice", weekly_stock: null, active: 1 },
      { id: "free-kopi", cost: 150, stall_id: "drinks", weekly_stock: 20, active: 1 },
      { id: "dollar-off-low", cost: 200, stall_id: null, weekly_stock: 30, active: 1 },
    ]);
  });

  it("allows only one pending redemption per student", async () => {
    const { raw } = await setup();
    const ins = (id: string, code: string) =>
      raw.exec(`INSERT INTO redemptions (id,user_id,reward_id,code,cost,status,created_at,expires_at) VALUES ('${id}','u-alex','egg-addon','${code}',80,'pending',1,2)`);
    ins("a", "AAAAAA");
    expect(() => ins("b", "BBBBBB")).toThrow(/UNIQUE/);
  });
});

describe("newCode without bias", () => {
  it("skips bytes that would favour some letters", () => {
    const bytes = [250, 251, 0, 1, 2, 3, 4, 5];
    let i = 0;
    const rand = (n: number) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]);
    expect(newCode(rand)).toBe("ABCDEF");
  });
});
