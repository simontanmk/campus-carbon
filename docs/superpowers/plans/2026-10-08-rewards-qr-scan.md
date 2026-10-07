# Rewards Phase 2: QR Scanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The student's live code is also shown as a QR code. The seller's "Redeem a reward" sheet gains **Scan code**, which reads that QR with the stall phone's camera and confirms it through the existing endpoint.

**Architecture:**
- No server changes.
- The QR holds `CCR:<CODE>`.
- A pure `parseRedeemQr` (in `src/app/redeemQr.ts`) turns scanned text into a code, or null for any other QR such as a claim link.
- `decodeFrame` (in `src/app/qrDecode.ts`) wraps jsQR and is loaded with a dynamic `import()`, so only the seller's scanner downloads it.
- The camera is opened with `getUserMedia`, and frames are sampled into a canvas every 200 ms.

**Tech Stack:** React 19, `jsqr@1.4.0` (Apache-2.0, a new dependency), `qrcode` (existing), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-07-rewards-design.md` §10 (Phase 2), plus §6.2 for the confirm endpoint.

## Global Constraints

- **QR text:** `CCR:` followed by the 6-character code. The parser also accepts a bare code or one with a dash, uppercase or lowercase. Anything else returns null.
- **Code alphabet:** `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 6 characters.
- **jsQR** is imported only from `src/app/qrDecode.ts`, and that module only through `import()`.
- **Camera:** `facingMode: "environment"`, no audio. The video element has `muted` and `playsInline`, which iOS needs.
- **Stopping the camera:** every track is stopped on unmount, close, successful scan and error.
- **Camera errors:**
  - `NotAllowedError` → "Camera blocked. Allow camera access, or type the code."
  - anything else (no camera, insecure origin) → "Couldn't open the camera. Type the code instead."
- **Typing the code stays available at all times.**
- **A scan submits straight away** to `POST /api/stall/redeem` with the code. The result and error UI are the same as for typing.

## Review Focus

1. **A claim QR (a `/claim?t=` URL) is scanned by mistake:** it's ignored and scanning continues, with no error and no request sent. *Task 1 parser test.*
2. **Camera permission denied, or no camera on a laptop:** a plain message, and the typing field still works. *Task 2 browser check (the preview has no camera).*
3. **The sheet is closed while the camera runs:** the camera light goes off, meaning every track is stopped. *Task 2 code: the effect cleanup.*
4. **The same QR stays in view after a scan:** only one confirm request is sent. The scanner stops at the first decode. *Task 2 code.*
5. **The student's screen is dimmed or small:** the QR is drawn at 360 px with a 1-module white margin on the white card. *Task 2.*

---

### Task 1: QR text and frame decoding

**Files:**
- Create: `src/app/redeemQr.ts`, `src/app/qrDecode.ts`
- Test: `test/redeem-qr.test.ts`
- Modify: `package.json` / `package-lock.json` (`npm install jsqr@1.4.0`)

**Interfaces:**
- Produces:
  - `QR_PREFIX = "CCR:"`
  - `redeemQrText(code: string): string`
  - `parseRedeemQr(text: string): string | null`
  - `decodeFrame(data: Uint8ClampedArray, width: number, height: number): string | null`

- [ ] **Step 1: Install and write the failing tests**

Run: `npm install jsqr@1.4.0`

Create `test/redeem-qr.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/redeem-qr.test.ts`
Expected: FAIL, because `src/app/qrDecode` can't be resolved.

- [ ] **Step 3: Implement**

Create `src/app/redeemQr.ts`:

```ts
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
```

Create `src/app/qrDecode.ts`:

```ts
import jsQR from "jsqr";
import { parseRedeemQr } from "./redeemQr";

/** Decode one camera frame. Only this module imports jsQR; load it with import() so students never download it. */
export function decodeFrame(data: Uint8ClampedArray, width: number, height: number): string | null {
  const hit = jsQR(data, width, height, { inversionAttempts: "dontInvert" });
  return hit ? parseRedeemQr(hit.data) : null;
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run test/redeem-qr.test.ts && npx vitest run && npm run typecheck`
Expected: all PASS, and typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/app/redeemQr.ts src/app/qrDecode.ts test/redeem-qr.test.ts
git commit -m "feat(rewards): reward QR text and camera-frame decoding"
```

---

### Task 2: Show the QR to the student, scan it at the stall

**Files:**
- Modify: `src/app/screens/Rewards.tsx` (QR in `LiveCode`)
- Modify: `src/app/screens/Stall.tsx` (`Scanner`, plus scan mode in `RedeemSheet`)
- Modify: `docs/demo-checklist.md`, and spec §10

**Interfaces:**
- Consumes: from Task 1, `redeemQrText` and a dynamic `import("../qrDecode")` for `decodeFrame`; `showCode` from `src/app/copy.ts`.
- Produces: `Scanner({ onCode, onError })` inside `Stall.tsx`.

- [ ] **Step 1: QR on the student's live code**

In `src/app/screens/Rewards.tsx`:
- Add the imports `import QRCode from "qrcode";` and `import { redeemQrText } from "../redeemQr";`.
- Inside `LiveCode`, add:

```tsx
  const [qr, setQr] = useState("");
  useEffect(() => {
    QRCode.toDataURL(redeemQrText(active.code), { margin: 1, width: 360 }).then(setQr).catch(() => {});
  }, [active.code]);
```

- Render it directly after the monospace code `<div>`:

```tsx
      {qr && <img src={qr} alt={`QR code for ${showCode(active.code)}`} width={180} height={180} style={{ alignSelf: "center" }} />}
```

- [ ] **Step 2: Scanner on the seller's sheet**

In `src/app/screens/Stall.tsx`:
- Make sure `useCallback` and `useRef` are imported from `react`.
- Add `import { showCode } from "../copy";` (merge it with the existing `copy` import).
- Add this component at the end of the file:

```tsx
/** Camera view that stops at the first reward QR it reads. jsQR loads only when the seller opens it. */
function Scanner({ onCode, onError }: { onCode: (code: string) => void; onError: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    (async () => {
      try {
        const { decodeFrame } = await import("../qrDecode");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped) return stop();
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const canvas = document.createElement("canvas");
        const g = canvas.getContext("2d", { willReadFrequently: true })!;
        const scan = () => {
          if (stopped) return;
          if (v.videoWidth) {
            const w = 480;
            const h = Math.round(v.videoHeight * (w / v.videoWidth));
            canvas.width = w;
            canvas.height = h;
            g.drawImage(v, 0, 0, w, h);
            const code = decodeFrame(g.getImageData(0, 0, w, h).data, w, h);
            if (code) {
              stop(); // one confirm per scan, even if the QR stays in view
              onCode(code);
              return;
            }
          }
          timer = window.setTimeout(scan, 200);
        };
        scan();
      } catch (e) {
        stop();
        onError((e as Error).name === "NotAllowedError" ? "Camera blocked. Allow camera access, or type the code." : "Couldn't open the camera. Type the code instead.");
      }
    })();
    return stop;
  }, [onCode, onError]);
  return (
    <video ref={video} muted playsInline aria-label="Camera view for scanning a reward code"
      style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 14, background: "#000" }} />
  );
}
```

In `RedeemSheet`:

1. Change `submit` so it can be called with a code directly:

```tsx
  async function send(value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api<{ reward_name: string; student_name: string }>("/stall/redeem", { code: value }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't redeem. Try again.");
    } finally {
      setBusy(false);
    }
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    send(code);
  }
```

   This replaces the old `async function submit(e)` body.

2. Add scan state and stable callbacks:

```tsx
  const [scanning, setScanning] = useState(false);
  const onCode = useCallback((c: string) => {
    setScanning(false);
    setCode(showCode(c));
    send(c);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- send reads fresh state through setters
  const onScanError = useCallback((m: string) => {
    setScanning(false);
    setError(m);
  }, []);
```

3. In the non-`done` branch, inside the `<form>`, before the `<input>`, render:

```tsx
            {scanning ? (
              <>
                <Scanner onCode={onCode} onError={onScanError} />
                <button type="button" className="btn btn-secondary" onClick={() => setScanning(false)}>Type the code instead</button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => { setError(null); setScanning(true); }}>Scan code</button>
            )}
```

   Change the existing Confirm button's class from `btn` to `btn btn-secondary`, so Scan is the primary action and typing is the fallback.

- [ ] **Step 3: Check it in the browser**

1. `npm run typecheck && npx vitest run`. Expected: all pass.
2. Student (Bea) → Rewards → Redeem the egg add-on. Expected: the code card shows `ABC-DEF` with a 180 px QR below it. Read the image's `naturalWidth`: expected 360.
3. As the Economy Rice seller, open Redeem a reward. Expected: **Scan code** (primary) above the code field.
4. Tap **Scan code**. The preview pane has no camera, so expect the error "Couldn't open the camera. Type the code instead." or "Camera blocked…". The scanner closes and typing still works (Review Focus 2).
5. Type the code and Confirm. Expected: "Free egg add-on for Bea".
6. Check the network panel: until Scan is tapped, no `jsqr` chunk has loaded. After tapping, a `qrDecode` chunk loads.

- [ ] **Step 4: Docs**

In `docs/demo-checklist.md`, after the Rewards line, add:

```markdown
- [ ] Rewards QR: seller phone → Redeem a reward → Scan code → allow camera → point at the student's QR → "<reward> for <name>" without typing; deny camera once and check typing still works
```

In `docs/superpowers/specs/2026-10-07-rewards-design.md`, at the end of §10, add:

```markdown

Implemented 2026-10-08:
- The QR holds `CCR:<code>`.
- jsQR 1.4.0 decodes it. It is loaded on demand, so students never download it. `BarcodeDetector` isn't used, because iOS Safari lacks it.
- The scanner stops at the first decode and submits once.
- Other QR codes, such as claim links, are ignored.
```

- [ ] **Step 5: Commit, deploy**

```bash
git add src/app/screens/Rewards.tsx src/app/screens/Stall.tsx docs/demo-checklist.md docs/superpowers/specs/2026-10-07-rewards-design.md
git commit -m "feat(app): reward QR on the student's code, camera scanning on the seller's sheet"
npm run deploy
```

Expected: the deploy succeeds. Opening the live site's stall screen over HTTPS lets the camera prompt appear on a real phone.
