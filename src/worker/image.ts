const MIMES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BASE64 = 2_000_000; // ~1.5 MB of image; the app resizes to 1024 px JPEG first

/** Validates an uploaded image and returns its bytes' SHA-256. The image itself is never stored. */
export async function decodeImage(raw: unknown): Promise<{ mime: string; base64: string; hash: string } | { error: string }> {
  if (!raw || typeof raw !== "object") return { error: "invalid" };
  const { mime, base64 } = raw as { mime?: unknown; base64?: unknown };
  if (typeof mime !== "string" || !MIMES.includes(mime)) return { error: "invalid" };
  if (typeof base64 !== "string" || base64.length === 0 || base64.length > MAX_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { error: "invalid" };
  let bytes: Uint8Array;
  try {
    const bin = atob(base64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return { error: "invalid" };
  }
  if (!matchesMime(bytes, mime)) return { error: "invalid" };
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { mime, base64, hash };
}

/** The file's own signature must match its declared type, so a text file labelled image/jpeg is refused. */
function matchesMime(b: Uint8Array, mime: string): boolean {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (mime === "image/jpeg") return starts(0xff, 0xd8, 0xff);
  if (mime === "image/png") return starts(0x89, 0x50, 0x4e, 0x47);
  if (mime === "image/webp") return starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return false;
}
