import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

type Item = { id: string; name: string; kind: string; kg_co2e: number | null; low_carbon: boolean };
type StallData = { stall: { id: string; name: string; canteen: string; active: boolean }; items: Item[] };
type Created = { id: string; claim_url: string; expires_at: number };
type Status = { state: "pending" | "claimed" | "expired"; claimed_by: string | null };

export function Stall() {
  const [data, setData] = useState<StallData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [byo, setByo] = useState(false);
  const [active, setActive] = useState<(Created & { item: Item; qr: string }) | null>(null);

  useEffect(() => {
    api<StallData>("/stall").then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load stall."));
  }, []);

  async function sell(item: Item) {
    setError(null);
    try {
      const t = await api<Created>("/stall/tokens", { item_id: item.id, byo });
      const qr = await QRCode.toDataURL(t.claim_url, { margin: 1, width: 560 });
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
      <h1>{data.stall.name}</h1>
      <p className="muted">{data.stall.canteen} · tap the item sold</p>
      <div className="card toggle">
        <span>Customer brought own cup / container</span>
        <input type="checkbox" checked={byo} onChange={(e) => setByo(e.target.checked)} aria-label="BYO" />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="grid">
        {data.items.map((i) => (
          <button key={i.id} className="item-btn" onClick={() => sell(i)}>
            <span>{i.name}</span>
            <span>
              {i.low_carbon && <span className="pill pill-green">Low-carbon</span>}{" "}
              <span className="muted">{i.kg_co2e == null ? "—" : `${i.kg_co2e} kg`}</span>
            </span>
          </button>
        ))}
      </div>
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
  const [status, setStatus] = useState<Status>({ state: "pending", claimed_by: null });

  useEffect(() => {
    setStatus({ state: "pending", claimed_by: null });
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

  const secondsLeft = Math.max(0, Math.ceil((active.expires_at - now) / 1000));
  const expired = status.state === "expired" || (status.state === "pending" && secondsLeft === 0);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet glass" onClick={(e) => e.stopPropagation()}>
        <h2>{active.item.name}{byo ? " + BYO" : ""}</h2>
        {status.state === "claimed" ? (
          <>
            <div className="big-number">✓</div>
            <p>Claimed by {status.claimed_by}</p>
          </>
        ) : expired ? (
          <>
            <p className="muted">Code expired</p>
            <button className="btn" onClick={onRegenerate}>New code</button>
          </>
        ) : (
          <>
            <img src={active.qr} alt="Claim QR code" />
            <p className="muted">Scan with your phone camera · {secondsLeft}s</p>
          </>
        )}
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
