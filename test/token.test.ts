import { describe, expect, it } from "vitest";
import { sign, verify } from "../src/worker/lib/token";

describe("token sign/verify", () => {
  it("round-trips a value", async () => {
    const s = await sign("abc-123", "k");
    expect(s.startsWith("abc-123.")).toBe(true);
    expect(await verify(s, "k")).toBe("abc-123");
  });

  it("uses only URL-safe characters", async () => {
    const s = await sign("x", "k");
    expect(s).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("rejects the wrong secret", async () => {
    expect(await verify(await sign("abc", "k1"), "k2")).toBeNull();
  });

  it("rejects a changed value or signature", async () => {
    const s = await sign("abc", "k");
    const [v, sig] = s.split(".");
    expect(await verify(`abd.${sig}`, "k")).toBeNull();
    expect(await verify(`${v}.${sig.slice(0, -2)}AA`, "k")).toBeNull();
  });

  it.each([["", ], ["garbage"], ["."], ["abc."], [".sig"], ["abc.!!!"]])("rejects malformed %j", async (bad) => {
    expect(await verify(bad, "k")).toBeNull();
  });

  it.each([[undefined], [null], [123], [{}]])("rejects non-string %j", async (bad) => {
    expect(await verify(bad, "k")).toBeNull();
  });
});
