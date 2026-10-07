/** No I, L, O, 0 or 1: they're misread when a seller types a code off a student's screen. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const VALID = new RegExp(`^[${CODE_ALPHABET}]{6}$`);

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** "k7p-q2m" → "K7PQ2M"; null unless it's exactly 6 alphabet characters. */
export function normalizeCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return VALID.test(s) ? s : null;
}
