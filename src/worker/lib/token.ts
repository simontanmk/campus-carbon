const enc = new TextEncoder();

function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function toB64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function sign(value: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(value));
  return `${value}.${toB64url(sig)}`;
}

export async function verify(signed: unknown, secret: string): Promise<string | null> {
  if (typeof signed !== "string") return null;
  const i = signed.lastIndexOf(".");
  if (i <= 0 || i === signed.length - 1) return null;
  const value = signed.slice(0, i);
  const sig = fromB64url(signed.slice(i + 1));
  if (!sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, enc.encode(value));
  return ok ? value : null;
}
