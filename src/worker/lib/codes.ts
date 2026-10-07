/** No I, L, O, 0 or 1: they're misread when a seller types a code off a student's screen. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const VALID = new RegExp(`^[${CODE_ALPHABET}]{6}$`);

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
/** Bytes ≥ 248 are skipped so each of the 31 characters is equally likely (248 = 8 × 31). */
const LIMIT = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;

export function newCode(rand: (n: number) => Uint8Array = randomBytes): string {
  let out = "";
  while (out.length < 6) {
    for (const b of rand(6)) {
      if (b < LIMIT && out.length < 6) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

/** "k7p-q2m" → "K7PQ2M"; null unless it's exactly 6 alphabet characters. */
export function normalizeCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return VALID.test(s) ? s : null;
}
