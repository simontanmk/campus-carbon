import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { pct, showCode } from "../copy";
import { runScanner } from "../scanner";

type Item = { id: string; name: string; kind: string; kg_co2e: number | null; low_carbon: boolean };
type StallData = { stall: { id: string; name: string; canteen: string; active: boolean; verify_method: "qr" | "nfc" | "both" }; items: Item[] };
type Created = { id: string; claim_url: string; expires_at: number; method: "qr" | "nfc"; server_now: number };
type Status = { state: "pending" | "tapped" | "claimed" | "expired"; claimed_by: string | null; pending_name: string | null };

export function Stall() {
  const [data, setData] = useState<StallData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [byo, setByo] = useState(false);
  const [active, setActive] = useState<(Created & { item: Item; qr: string; local_expires_at: number }) | null>(null);
  const [mode, setMode] = useState<"qr" | "nfc">("qr");
  const [refresh, setRefresh] = useState(0);
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    api<StallData>("/stall").then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load stall."));
  }, []);
  useEffect(() => {
    if (data?.stall.verify_method === "nfc") setMode("nfc");
  }, [data]);

  async function sell(item: Item) {
    setError(null);
    try {
      const t = await api<Created>("/stall/tokens", { item_id: item.id, byo, method: mode });
      const qr = t.method === "qr" ? await QRCode.toDataURL(t.claim_url, { margin: 1, width: 560 }) : "";
      // Count down on this device's clock from the server's remaining time, so a skewed clock can't shift it.
      setActive({ ...t, item, qr, local_expires_at: Date.now() + (t.expires_at - t.server_now) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create a code.");
    }
  }

  function close() {
    setActive(null);
    setRefresh((r) => r + 1);
    setByo(false);
  }

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return null;

  return (
    <>
      <div>
        <div className="eyebrow">{data.stall.canteen}</div>
        <h1 className="display" style={{ marginTop: 8 }}>{data.stall.name}</h1>
      </div>
      <StallWeek refresh={refresh} />
      <label className="toggle-row">
        <span>Own cup or container</span>
        <span className="switch">
          <input type="checkbox" checked={byo} onChange={(e) => setByo(e.target.checked)} aria-label="Customer brought own cup or container" />
          <span />
        </span>
      </label>
      {data.stall.verify_method === "both" && (
        <div className="segmented" role="group" aria-label="How the customer claims">
          <button aria-pressed={mode === "qr"} onClick={() => setMode("qr")}>QR code</button>
          <button aria-pressed={mode === "nfc"} onClick={() => setMode("nfc")}>NFC sticker</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="grid">
        {data.items.map((i) => (
          <button key={i.id} className="item-btn" onClick={() => sell(i)}>
            <span>{i.name.replace(/^Economy rice: /, "")}</span>
            <span className={i.low_carbon ? "tag green" : "tag"}>
              {i.low_carbon ? "Low-carbon · " : ""}
              {i.kg_co2e == null ? "kg unknown" : `${i.kg_co2e} kg`}
            </span>
          </button>
        ))}
      </div>
      <p className="muted" style={{ textAlign: "center" }}>{mode === "nfc" ? "Tap the item sold, then ask the customer to tap the sticker" : "Tap the item sold to show a code"}</p>
      <button className="btn btn-secondary" onClick={() => setRedeeming(true)}>Redeem a reward</button>
      {redeeming && <RedeemSheet onClose={() => setRedeeming(false)} />}
      {active && <QrSheet active={active} byo={byo} onClose={close} onRegenerate={() => sell(active.item)} />}
    </>
  );
}

function QrSheet({
  active,
  byo,
  onClose,
  onRegenerate,
}: {
  active: Created & { item: Item; qr: string; local_expires_at: number };
  byo: boolean;
  onClose: () => void;
  onRegenerate: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<Status>({ state: "pending", claimed_by: null, pending_name: null });

  useEffect(() => {
    setStatus({ state: "pending", claimed_by: null, pending_name: null });
    const tick = setInterval(() => setNow(Date.now()), 250);
    const poll = setInterval(async () => {
      try {
        const s = await api<Status>(`/stall/tokens/${active.id}`);
        setStatus(s);
      } catch {
        /* keep last status; next poll retries */
      }
    }, 2000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [active.id]);

  useEffect(() => {
    if (status.state !== "claimed") return;
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [status.state, onClose]);

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  async function confirm() {
    if (confirming) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      const r = await api<{ claimed_by: string }>(`/stall/tokens/${active.id}/confirm`, {});
      setStatus({ state: "claimed", claimed_by: r.claimed_by, pending_name: null });
    } catch (e) {
      // Say why (daily limit, too soon at this stall, already confirmed); an expired code offers a new one.
      if (e instanceof ApiError && e.status === 410) setStatus((s) => ({ ...s, state: "expired" }));
      else setConfirmError(e instanceof ApiError ? e.message : "Couldn't confirm. Try again.");
    } finally {
      setConfirming(false);
    }
  }

  const [clearing, setClearing] = useState(false);
  async function clearTap() {
    setClearing(true);
    setConfirmError(null);
    try {
      await api(`/stall/tokens/${active.id}/clear`, {});
      setStatus({ state: "pending", claimed_by: null, pending_name: null });
    } catch {
      setConfirmError("Couldn't clear. Close this and tap the item again.");
    } finally {
      setClearing(false);
    }
  }

  const secondsLeft = Math.max(0, Math.ceil((active.local_expires_at - now) / 1000));
  const seconds = <span style={{ fontVariantNumeric: "tabular-nums" }}>{secondsLeft}s</span>;
  const expired = status.state === "expired" || ((status.state === "pending" || status.state === "tapped") && secondsLeft === 0);

  return (
    // Tapping outside only closes a finished sheet; a live code stays up until Close.
    <div className="sheet-backdrop" onClick={status.state === "claimed" || expired ? onClose : undefined}>
      <div className="sheet glass" onClick={(e) => e.stopPropagation()}>
        <h2 className="title">{active.item.name}{byo ? " + own container" : ""}</h2>
        {status.state === "claimed" ? (
          <>
            <svg className="check" width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
              <circle cx="46" cy="46" r="40" fill="none" stroke="var(--accent)" strokeWidth="5" />
              <path d="M30 47 l11 11 l21 -23" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="body" style={{ color: "var(--text)" }}>Claimed by {status.claimed_by}</p>
          </>
        ) : expired ? (
          <>
            <p className="body">This code expired.</p>
            <button className="btn" onClick={onRegenerate}>New code</button>
          </>
        ) : active.method === "nfc" ? (
          status.state === "tapped" ? (
            <>
              <p className="body" style={{ color: "var(--text)" }}>{status.pending_name} tapped the sticker.</p>
              {confirmError && <p className="error">{confirmError}</p>}
              <button className="btn" disabled={confirming || clearing} onClick={confirm}>Confirm</button>
              <p className="muted">
                Only confirm if they're in front of you · {seconds} ·{" "}
                <button className="link-btn" disabled={clearing || confirming} onClick={clearTap}>Not them?</button>
              </p>
            </>
          ) : (
            <>
              <div className="pulse"><span>Tap</span></div>
              <p className="muted">Ask the customer to tap their phone on the sticker · {seconds}</p>
            </>
          )
        ) : (
          <>
            <img src={active.qr} alt="Claim QR code" />
            <p className="muted">Scan with your phone camera · {seconds}</p>
          </>
        )}
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

type WeekStats = { meals: number; low_carbon_share: number | null; avg_kg: number | null; byo: number };

function StallWeek({ refresh }: { refresh: number }) {
  const [d, setD] = useState<{ this_week: WeekStats; last_week: WeekStats } | null>(null);
  useEffect(() => {
    api<{ this_week: WeekStats; last_week: WeekStats }>("/stall/insights").then(setD).catch(() => {});
  }, [refresh]);
  if (!d) return null;
  const cell = (n: string, label: string, last: string) => (
    <div>
      <div className="num" style={{ fontSize: 24 }}>{n}</div>
      <div className="label">{label}</div>
      <div className="label">last week: {last}</div>
    </div>
  );
  return (
    <div className="panel">
      <div className="eyebrow" style={{ marginBottom: 10 }}>Your stall this week</div>
      <div className="figures">
        {cell(String(d.this_week.meals), "meals claimed", String(d.last_week.meals))}
        {cell(pct(d.this_week.low_carbon_share), "low-carbon", pct(d.last_week.low_carbon_share))}
        {cell(String(d.this_week.byo), "own containers", String(d.last_week.byo))}
      </div>
    </div>
  );
}

function RedeemSheet({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reward_name: string; student_name: string } | null>(null);

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

  return (
    <div className="sheet-backdrop" onClick={done ? onClose : undefined}>
      <div className="sheet glass" onClick={(e) => e.stopPropagation()}>
        <h2 className="title">Redeem a reward</h2>
        {done ? (
          <>
            <svg className="check" width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
              <circle cx="46" cy="46" r="40" fill="none" stroke="var(--accent)" strokeWidth="5" />
              <path d="M30 47 l11 11 l21 -23" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="body" style={{ color: "var(--text)" }}>{done.reward_name} for {done.student_name}</p>
            <button className="btn" onClick={onClose}>Done</button>
          </>
        ) : (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {scanning ? (
              <>
                <Scanner onCode={onCode} onError={onScanError} />
                <button type="button" className="btn btn-secondary" onClick={() => setScanning(false)}>Type the code instead</button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); setError(null); setScanning(true); }}>Scan code</button>
            )}
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC-DEF"
              maxLength={7}
              autoCapitalize="characters"
              autoComplete="off"
              autoFocus
              aria-label="Reward code"
              style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 28, letterSpacing: "0.08em", textAlign: "center" }}
            />
            {error && <p className="error">{error}</p>}
            <button className="btn btn-secondary" disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length !== 6}>Confirm</button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Camera view that stops at the first reward QR it reads. jsQR loads only when the seller opens it. */
function Scanner({ onCode, onError }: { onCode: (code: string) => void; onError: (message: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    return runScanner({
      loadDecoder: async () => (await import("../qrDecode")).decodeFrame,
      openCamera: () => navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }),
      attach: async (stream) => {
        const v = video.current;
        if (!v) throw new Error("closed");
        v.srcObject = stream as MediaStream;
        await v.play();
      },
      grab: () => {
        const v = video.current;
        if (!v || !v.videoWidth) return null;
        const w = 480;
        const h = Math.round(v.videoHeight * (w / v.videoWidth));
        canvas.width = w;
        canvas.height = h;
        g.drawImage(v, 0, 0, w, h);
        return { data: g.getImageData(0, 0, w, h).data, width: w, height: h };
      },
      onCode,
      onError,
    });
  }, [onCode, onError]);
  return (
    <video ref={video} muted playsInline aria-label="Camera view for scanning a reward code"
      style={{ width: "100%", aspectRatio: "4 / 3", maxHeight: "38vh", objectFit: "cover", borderRadius: 14, background: "#000" }} />
  );
}
