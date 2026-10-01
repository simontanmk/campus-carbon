import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { navigate } from "../router";

type Result = { item_name: string; stall_name: string; low_carbon: boolean; kg_co2e: number | null; points: number; activities: { type: string; points: number }[] };
type Status = { state: "waiting" | "confirmed" | "expired"; stall_name: string; item_name: string; result?: Result };

export function Tap() {
  const started = useRef(false);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const stall_id = new URLSearchParams(location.search).get("stall") ?? "";
    api<{ token_id: string; stall_name: string; item_name: string }>("/tap", { stall_id })
      .then((r) => {
        setTokenId(r.token_id);
        setStatus({ state: "waiting", stall_name: r.stall_name, item_name: r.item_name });
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Tap the sticker again."));
  }, []);

  useEffect(() => {
    if (!tokenId || status?.state !== "waiting") return;
    const t = setInterval(() => api<Status>(`/tap/${tokenId}`).then(setStatus).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [tokenId, status?.state]);

  if (error) {
    return (
      <div className="result">
        <h1 className="title">Couldn't tap in</h1>
        <p className="body">{error}</p>
        <div style={{ width: "100%", marginTop: 24 }}><button className="btn btn-secondary" onClick={() => navigate("/")}>Go home</button></div>
      </div>
    );
  }
  if (!status) return <p className="muted result">Tapping in…</p>;
  if (status.state === "waiting") {
    return (
      <div className="result">
        <div className="pulse"><span>Wait</span></div>
        <div className="title" style={{ fontSize: 20, marginTop: 16 }}>{status.item_name}</div>
        <p className="muted">{status.stall_name} · waiting for the seller to confirm</p>
      </div>
    );
  }
  if (status.state === "expired" || !status.result) {
    return (
      <div className="result">
        <h1 className="title">The seller didn't confirm in time</h1>
        <p className="body">Ask them to tap the item again, then tap the sticker.</p>
        <div style={{ width: "100%", marginTop: 24 }}><button className="btn btn-secondary" onClick={() => navigate("/")}>Go home</button></div>
      </div>
    );
  }
  const r = status.result;
  const byo = r.activities.find((a) => a.type === "byo");
  const main = r.activities.find((a) => a.type !== "byo");
  const parts = [r.low_carbon && main ? `Low-carbon meal +${main.points}` : null, byo ? `Own container +${byo.points}` : null].filter(Boolean);
  return (
    <div className="result">
      <svg className="check" width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
        <circle cx="46" cy="46" r="40" fill="none" stroke="var(--accent)" strokeWidth="5" />
        <path d="M30 47 l11 11 l21 -23" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="num-xl" style={{ marginTop: 8 }}>{r.points > 0 ? `+${r.points}` : "Logged"}</div>
      <div className="title" style={{ fontSize: 20 }}>{r.item_name}</div>
      <div className="muted">{r.stall_name}{r.kg_co2e != null && ` · ${r.kg_co2e} kg CO₂e`}</div>
      {parts.length > 0 && <div className="muted" style={{ borderTop: "0.5px solid var(--line)", paddingTop: 12, marginTop: 4, color: "var(--text-2)" }}>{parts.join(" · ")}</div>}
      <div style={{ width: "100%", marginTop: 28 }}><button className="btn" onClick={() => navigate("/")}>Done</button></div>
    </div>
  );
}
