import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

type Item = { id: string; name: string; kind: string; kg_co2e: number | null; low_carbon: boolean };
type StallData = { stall: { id: string; name: string; canteen: string; active: boolean; verify_method: "qr" | "nfc" | "both" }; items: Item[] };
type Created = { id: string; claim_url: string; expires_at: number; method: "qr" | "nfc" };
type Status = { state: "pending" | "tapped" | "claimed" | "expired"; claimed_by: string | null; pending_name: string | null };

export function Stall() {
  const [data, setData] = useState<StallData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [byo, setByo] = useState(false);
  const [active, setActive] = useState<(Created & { item: Item; qr: string }) | null>(null);
  const [mode, setMode] = useState<"qr" | "nfc">("qr");

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
      setActive({ ...t, item, qr });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create a code.");
    }
  }

  function close() {
    setActive(null);
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
  active: Created & { item: Item; qr: string };
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

  const secondsLeft = Math.max(0, Math.ceil((active.expires_at - now) / 1000));
  const expired = status.state === "expired" || ((status.state === "pending" || status.state === "tapped") && secondsLeft === 0);

  return (
    <div className="sheet-backdrop" onClick={status.state === "tapped" ? undefined : onClose}>
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
              <button className="btn" disabled={confirming} onClick={confirm}>Confirm</button>
              <p className="muted">Only confirm if they're in front of you.</p>
            </>
          ) : (
            <>
              <div className="pulse"><span>Tap</span></div>
              <p className="muted">Ask the customer to tap their phone on the sticker · <span style={{ fontVariantNumeric: "tabular-nums" }}>{secondsLeft}s</span></p>
            </>
          )
        ) : (
          <>
            <img src={active.qr} alt="Claim QR code" />
            <p className="muted">Scan with your phone camera · <span style={{ fontVariantNumeric: "tabular-nums" }}>{secondsLeft}s</span></p>
          </>
        )}
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
