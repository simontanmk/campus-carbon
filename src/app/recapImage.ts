import QRCode from "qrcode";
import { recapLines, type RecapData } from "./copy";

const W = 1080;
const H = 1920;
const M = 96; // side margin
const SERIF = 'ui-serif, "New York", "Iowan Old Style", Georgia, serif';
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Story-sized PNG of the student's week, drawn on the phone (nothing is uploaded). */
export async function drawRecap(d: RecapData, origin: string): Promise<Blob> {
  await document.fonts?.ready;
  const L = recapLines(d);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const text = (s: string, x: number, y: number, font: string, color: string, maxWidth = W - 2 * M) => {
    g.font = font;
    g.fillStyle = color;
    g.textAlign = "left";
    g.fillText(s, x, y, maxWidth); // maxWidth squeezes long names instead of running off the card
  };

  g.fillStyle = "#f7f6f2";
  g.fillRect(0, 0, W, H);

  text(L.eyebrow, M, 180, `600 34px ${SANS}`, "#8e8e93");
  text(L.title, M, 250, `44px ${SANS}`, "#1c1c1e");
  text(L.headline, M, 560, `260px ${SERIF}`, "#2e7d50");
  text(L.headlineLabel, M, 640, `44px ${SANS}`, "#6e6e73");

  const pw = 420;
  const ph = 260;
  const gap = 48;
  const top = 740;
  L.panels.forEach((p, i) => {
    const x = M + (i % 2) * (pw + gap);
    const y = top + Math.floor(i / 2) * (ph + gap);
    g.fillStyle = "#ecebe6";
    g.beginPath();
    g.roundRect(x, y, pw, ph, 40);
    g.fill();
    text(p.value, x + 40, y + 130, `84px ${SERIF}`, "#1c1c1e", pw - 80);
    text(p.label, x + 40, y + 200, `34px ${SANS}`, "#6e6e73", pw - 80);
  });

  let y = top + 2 * ph + gap + 110;
  for (const e of L.extras) {
    text(e, M, y, `44px ${SANS}`, "#1c1c1e");
    y += 70;
  }

  const qrSize = 240;
  const qr = await loadImage(await QRCode.toDataURL(`${origin}/`, { margin: 1, width: qrSize }));
  g.drawImage(qr, W - M - qrSize, H - M - qrSize, qrSize, qrSize);
  text("Join at", M, H - 250, `36px ${SANS}`, "#6e6e73", 560);
  text(new URL(origin).host, M, H - 195, `44px ${SANS}`, "#1c1c1e", 560);
  text(L.footnote, M, H - 110, `28px ${SANS}`, "#8e8e93", 560);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}
