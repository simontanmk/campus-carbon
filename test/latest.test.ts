import { describe, expect, it } from "vitest";
import { latestOnly } from "../src/app/latest";

const later = <T,>(v: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(v), ms));

describe("latestOnly", () => {
  it("drops a slower, earlier answer so a newer choice isn't overwritten", async () => {
    const latest = latestOnly();
    const got: string[] = [];
    const a = latest(later("last", 30)).then((v) => got.push(v));
    const b = latest(later("this", 5)).then((v) => got.push(v));
    await b;
    await later(null, 50);
    expect(got).toEqual(["this"]);
    void a;
  });

  it("passes the latest call's error through, and drops stale errors", async () => {
    const latest = latestOnly();
    let stale = false;
    latest(Promise.reject(new Error("old"))).catch(() => (stale = true));
    await expect(latest(Promise.reject(new Error("new")))).rejects.toThrow("new");
    await later(null, 5);
    expect(stale).toBe(false);
  });
});
