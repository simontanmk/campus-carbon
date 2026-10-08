import { describe, expect, it } from "vitest";
import { checkReceipt, parseSgMinute } from "../src/worker/lib/receipt";
import { RECEIPT_PROMPT, validateReceipt } from "../src/worker/lib/ai-tasks";

const DAY = 86_400_000;
// 2026-10-08 15:00 SGT
const NOW = Date.UTC(2026, 9, 8, 7, 0);
const JOINED = NOW - 30 * DAY;
const read = (over: Partial<Parameters<typeof checkReceipt>[0]> = {}) => ({
  is_bcrs_refund: true, provider: "paylah" as const, amount_cents: 30, refunded_at: "2026-10-08 14:41", ...over,
});

describe("parseSgMinute", () => {
  it("reads YYYY-MM-DD HH:MM as Singapore time", () => {
    expect(parseSgMinute("2026-10-08 14:41")).toBe(Date.UTC(2026, 9, 8, 6, 41));
  });
  it.each(["2026-10-08", "08/10/2026 14:41", "2026-13-01 10:00", "2026-02-30 10:00", "2026-10-08 24:00", "2026-10-08 9:05"])("rejects %s", (s) => {
    expect(parseSgMinute(s)).toBeNull();
  });
});

describe("checkReceipt", () => {
  it("turns a 30¢ refund into 3 containers with a global key", () => {
    expect(checkReceipt(read(), NOW, JOINED)).toEqual({
      ok: true, containers: 3, provider: "paylah", amountCents: 30, refundedAt: Date.UTC(2026, 9, 8, 6, 41), key: "paylah:2026-10-08T14:41:30",
    });
  });

  it.each([
    ["not a BCRS refund", { is_bcrs_refund: false }],
    ["no provider", { provider: null }],
    ["no amount", { amount_cents: null }],
    ["no date", { refunded_at: null }],
  ])("not_receipt when %s", (_n, over) => {
    expect(checkReceipt(read(over as any), NOW, JOINED)).toMatchObject({ ok: false, code: "not_receipt" });
  });

  it.each([[0], [25], [-10], [2010]])("bad_amount for %i cents", (amount_cents) => {
    expect(checkReceipt(read({ amount_cents }), NOW, JOINED)).toMatchObject({ ok: false, code: "bad_amount" });
  });

  it("accepts 2000 cents (200 containers)", () => {
    expect(checkReceipt(read({ amount_cents: 2000 }), NOW, JOINED)).toMatchObject({ ok: true, containers: 200 });
  });

  it("accepts a refund exactly 3 days old, rejects one a minute older", () => {
    expect(checkReceipt(read({ refunded_at: "2026-10-05 15:00" }), NOW, JOINED)).toMatchObject({ ok: true });
    expect(checkReceipt(read({ refunded_at: "2026-10-05 14:59" }), NOW, JOINED)).toMatchObject({ ok: false, code: "receipt_date", message: "Upload a refund from the last 3 days." });
  });

  it("allows 10 minutes of clock drift into the future, no more", () => {
    expect(checkReceipt(read({ refunded_at: "2026-10-08 15:10" }), NOW, JOINED)).toMatchObject({ ok: true });
    expect(checkReceipt(read({ refunded_at: "2026-10-08 15:11" }), NOW, JOINED)).toMatchObject({ ok: false, code: "receipt_date" });
  });

  it("rejects a refund from before the student joined, but not one in the minute they joined", () => {
    const joined = Date.UTC(2026, 9, 8, 6, 41) + 30_000; // 14:41:30 SGT
    expect(checkReceipt(read({ refunded_at: "2026-10-08 14:41" }), NOW, joined)).toMatchObject({ ok: true });
    expect(checkReceipt(read({ refunded_at: "2026-10-08 14:40" }), NOW, joined)).toMatchObject({ ok: false, code: "receipt_date", message: "That refund is from before you joined." });
  });

  it("treats an unreadable date as not a receipt", () => {
    expect(checkReceipt(read({ refunded_at: "yesterday" }), NOW, JOINED)).toMatchObject({ ok: false, code: "not_receipt" });
  });

  it("uses a minute-precision key so another screenshot of the same refund matches", () => {
    const a = checkReceipt(read({ provider: "simplygo", amount_cents: 50 }), NOW, JOINED);
    expect(a).toMatchObject({ key: "simplygo:2026-10-08T14:41:50" });
  });
});

describe("validateReceipt", () => {
  it("keeps a well-formed reply", () => {
    expect(validateReceipt({ is_bcrs_refund: true, provider: "PayLah", amount_cents: 30, refunded_at: " 2026-10-08 14:41 " })).toEqual({
      is_bcrs_refund: true, provider: "paylah", amount_cents: 30, refunded_at: "2026-10-08 14:41",
    });
  });
  it("maps SimplyGo and EZ-Link spellings", () => {
    expect(validateReceipt({ is_bcrs_refund: true, provider: "SimplyGo EZ-Link", amount_cents: 10, refunded_at: "2026-10-08 10:00" })?.provider).toBe("simplygo");
    expect(validateReceipt({ is_bcrs_refund: true, provider: "ezlink", amount_cents: 10, refunded_at: "2026-10-08 10:00" })?.provider).toBe("simplygo");
  });
  it("nulls unknown or mistyped fields instead of failing", () => {
    expect(validateReceipt({ is_bcrs_refund: true, provider: "grabpay", amount_cents: "30", refunded_at: 5 })).toEqual({
      is_bcrs_refund: true, provider: null, amount_cents: null, refunded_at: null,
    });
    expect(validateReceipt({ is_bcrs_refund: true, provider: "paylah", amount_cents: 30.5, refunded_at: "2026-10-08 10:00" })?.amount_cents).toBeNull();
  });
  it("needs a boolean is_bcrs_refund", () => {
    expect(validateReceipt({ provider: "paylah" })).toBeNull();
    expect(validateReceipt("yes")).toBeNull();
  });
  it("tells the model today's SGT date", () => {
    expect(RECEIPT_PROMPT(NOW)).toContain("2026-10-08");
  });
});
