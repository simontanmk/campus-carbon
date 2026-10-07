/** What the student's reward QR says; the prefix keeps other QR codes (claim links, menus) from being read as rewards. */
export const QR_PREFIX = "CCR:";
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export const redeemQrText = (code: string): string => `${QR_PREFIX}${code}`;

/** The 6-character code in a scanned QR, or null for any other QR. */
export function parseRedeemQr(text: string): string | null {
  const t = text.trim().toUpperCase();
  const body = (t.startsWith(QR_PREFIX) ? t.slice(QR_PREFIX.length) : t).replace(/-/g, "");
  return CODE.test(body) ? body : null;
}
