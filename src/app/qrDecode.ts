import jsQR from "jsqr";
import { parseRedeemQr } from "./redeemQr";

/** Decode one camera frame. Only this module imports jsQR; load it with import() so students never download it. */
export function decodeFrame(data: Uint8ClampedArray, width: number, height: number): string | null {
  const hit = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
  return hit ? parseRedeemQr(hit.data, { requirePrefix: true }) : null;
}
