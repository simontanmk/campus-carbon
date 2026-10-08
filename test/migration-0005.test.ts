import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

describe("migration 0005 (receipt returns)", () => {
  it("keeps every existing activity and accepts receipt rows", () => {
    const db = new DatabaseSync(":memory:");
    const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();
    for (const f of files.filter((f) => f < "0005")) db.exec(readFileSync(`migrations/${f}`, "utf8"));
    db.exec(`INSERT INTO users (id, display_name, role, created_at) VALUES ('u1', 'A', 'student', 1)`);
    db.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,image_hash,detail_json,created_at) VALUES ('a1','u1','waste','container_return',15,0,'manual',NULL,'{"count":3}',2)`);
    db.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,image_hash,created_at) VALUES ('a2','u1','food','meal',5,0,'photo','h',3)`);
    db.exec(readFileSync("migrations/0005_receipt_returns.sql", "utf8"));
    expect(db.prepare("SELECT id, source, detail_json, receipt_key FROM activities ORDER BY id").all().map((r) => ({ ...r }))).toEqual([
      { id: "a1", source: "manual", detail_json: '{"count":3}', receipt_key: null },
      { id: "a2", source: "photo", detail_json: "{}", receipt_key: null },
    ]);
    db.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,receipt_key,created_at) VALUES ('a3','u1','waste','container_return',5,0,'receipt','k',4)`);
    expect(() => db.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,receipt_key,created_at) VALUES ('a4','u1','waste','container_return',5,0,'receipt','k',5)`)).toThrow(/receipt_key/);
    expect(() => db.exec(`INSERT INTO activities (id,user_id,category,type,points,verified,source,image_hash,created_at) VALUES ('a5','u1','food','meal',5,0,'photo','h',6)`)).toThrow(/image_hash/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='activities' AND name LIKE 'idx_%' ORDER BY name").all().map((r: any) => r.name)).toEqual(["idx_activities_stall_time", "idx_activities_user_time"]);
  });
});
