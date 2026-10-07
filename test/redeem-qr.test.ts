import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { decodeFrame } from "../src/app/qrDecode";
import { parseRedeemQr, redeemQrText } from "../src/app/redeemQr";

/** Render text as a QR into RGBA pixels, like a camera frame of the student's screen. */
function frame(text: string, scale = 4, margin = 4) {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = q.modules.size;
  const size = (n + 2 * margin) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (q.modules.data[r * n + c])
        for (let y = 0; y < scale; y++)
          for (let x = 0; x < scale; x++) {
            const i = (((r + margin) * scale + y) * size + (c + margin) * scale + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = 0;
          }
  return { data, size };
}

describe("parseRedeemQr", () => {
  it("reads our QR text, a bare code, or a typed-looking code", () => {
    expect(redeemQrText("K7PQ2M")).toBe("CCR:K7PQ2M");
    expect(parseRedeemQr("CCR:K7PQ2M")).toBe("K7PQ2M");
    expect(parseRedeemQr("k7p-q2m")).toBe("K7PQ2M");
  });
  it.each([
    ["https://campus-carbon.stan322.workers.dev/claim?t=abc.def"],
    ["CCR:K7PQ2"],
    ["CCR:O0I1LQ"],
    [""],
  ])("ignores %j", (t) => {
    expect(parseRedeemQr(t)).toBeNull();
  });
});

describe("decodeFrame", () => {
  it("finds the code in a frame showing the student's QR", () => {
    const { data, size } = frame(redeemQrText("AZR2HT"));
    expect(decodeFrame(data, size, size)).toBe("AZR2HT");
  });
  it("ignores a frame showing a claim QR", () => {
    const { data, size } = frame("https://campus-carbon.stan322.workers.dev/claim?t=abc.def");
    expect(decodeFrame(data, size, size)).toBeNull();
  });
  it("returns null for a frame with no QR", () => {
    expect(decodeFrame(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64)).toBeNull();
  });
});
