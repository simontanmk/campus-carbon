// BCRS refund receipt rules (spec 2026-10-08-bcrs-receipt-returns-design.md §5). The AI only reads the
// screenshot; everything that decides points is checked here.

export type ReceiptRead = {
  is_bcrs_refund: boolean;
  provider: "paylah" | "simplygo" | null;
  amount_cents: number | null;
  refunded_at: string | null; // "YYYY-MM-DD HH:MM", Singapore time
};

export type ReceiptCheck =
  | { ok: true; containers: number; provider: "paylah" | "simplygo"; amountCents: number; refundedAt: number; key: string }
  | { ok: false; code: "not_receipt" | "bad_amount" | "receipt_date"; message: string };

const MIN = 60_000;
const DAY = 86_400_000;
const SG_OFFSET = 8 * 3_600_000;
export const DEPOSIT_CENTS = 10;
export const MAX_AGE_DAYS = 3;
const MAX_CENTS = 2000;
const DRIFT_MS = 10 * MIN;

/** "YYYY-MM-DD HH:MM" in Singapore time → epoch ms, or null if it isn't a real date and time. */
export function parseSgMinute(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(utc).getUTCDate() !== d) return null; // 30 Feb rolls over
  return utc - SG_OFFSET;
}

const fail = (code: "not_receipt" | "bad_amount" | "receipt_date", message: string): ReceiptCheck => ({ ok: false, code, message });

export function checkReceipt(r: ReceiptRead, now: number, joinedAt: number): ReceiptCheck {
  const notReceipt = () => fail("not_receipt", "Couldn't find a BCRS deposit refund in that screenshot. Upload the refund from PayLah! or SimplyGo.");
  if (!r.is_bcrs_refund || !r.provider || r.amount_cents == null || !r.refunded_at) return notReceipt();
  const at = parseSgMinute(r.refunded_at);
  if (at == null) return notReceipt();
  const cents = r.amount_cents;
  if (!Number.isInteger(cents) || cents <= 0 || cents % DEPOSIT_CENTS !== 0 || cents > MAX_CENTS) {
    return fail("bad_amount", "That refund amount doesn't match 10¢ per container.");
  }
  if (at > now + DRIFT_MS || at < now - MAX_AGE_DAYS * DAY) return fail("receipt_date", "Upload a refund from the last 3 days.");
  // The receipt shows minutes only, so a refund in the same minute the student joined still counts.
  if (at + MIN <= joinedAt) return fail("receipt_date", "That refund is from before you joined.");
  return {
    ok: true,
    containers: cents / DEPOSIT_CENTS,
    provider: r.provider,
    amountCents: cents,
    refundedAt: at,
    key: `${r.provider}:${r.refunded_at.replace(" ", "T")}:${cents}`,
  };
}
