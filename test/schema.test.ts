import { describe, expect, it } from "vitest";
import { createTestD1 } from "./helpers/d1";

describe("schema", () => {
  it("creates every table from the spec", () => {
    const { raw } = createTestD1();
    const names = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "activities", "badges", "factors", "items", "locations", "missions", "routes",
        "settings", "stalls", "summaries", "tokens", "user_badges", "user_missions", "users",
      ]),
    );
  });

  it("adapter supports bind/first/all/run/batch like D1", async () => {
    const { d1 } = createTestD1();
    await d1.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind("a", "1").run();
    const run = await d1.prepare("UPDATE settings SET value=? WHERE key=?").bind("2", "a").run();
    expect(run.meta.changes).toBe(1);
    expect(await d1.prepare("SELECT value FROM settings WHERE key=?").bind("a").first()).toEqual({ value: "2" });
    expect(await d1.prepare("SELECT value FROM settings WHERE key=?").bind("a").first("value")).toBe("2");
    expect(await d1.prepare("SELECT value FROM settings WHERE key=?").bind("zz").first()).toBeNull();
    await d1.batch([
      d1.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind("b", "1"),
      d1.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind("c", "1"),
    ]);
    const all = await d1.prepare("SELECT key FROM settings ORDER BY key").all();
    expect(all.results.map((r: any) => r.key)).toEqual(["a", "b", "c"]);
  });

  it("batch rolls back entirely on failure", async () => {
    const { d1 } = createTestD1();
    await expect(
      d1.batch([
        d1.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind("x", "1"),
        d1.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").bind("x", "dup"),
      ]),
    ).rejects.toThrow();
    expect(await d1.prepare("SELECT COUNT(*) AS n FROM settings").first("n")).toBe(0);
  });

  it("rejects duplicate image_hash on activities", () => {
    const { raw } = createTestD1();
    raw.exec("INSERT INTO users (id, display_name, role, created_at) VALUES ('u','U','student',0)");
    const ins = "INSERT INTO activities (id,user_id,category,type,points,verified,source,image_hash,created_at) VALUES (?, 'u','food','meal',0,0,'photo','h',0)";
    raw.prepare(ins).run("a1");
    expect(() => raw.prepare(ins).run("a2")).toThrow();
  });
});
