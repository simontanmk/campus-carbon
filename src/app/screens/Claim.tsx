import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { navigate } from "../router";

type Result = {
  item_name: string;
  stall_name: string;
  kind: string;
  low_carbon: boolean;
  kg_co2e: number | null;
  points: number;
  activities: { type: string; points: number; kg_co2e: number | null }[];
};

export function Claim() {
  const started = useRef(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev; claim exactly once
    started.current = true;
    const t = new URLSearchParams(location.search).get("t") ?? "";
    if (!t) {
      navigate("/"); // Back or refresh after a claim: nothing to claim, no false error
      return;
    }
    history.replaceState(null, "", "/claim"); // a refresh must not retry a used token
    api<Result>("/claim", { t })
      .then(setResult)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Check your connection, then scan the code again. If your points already show on Today, you're done."));
  }, []);

  if (error) {
    return (
      <div className="result">
        <h1 className="title">Couldn't claim</h1>
        <p className="body">{error}</p>
        <div style={{ width: "100%", marginTop: 24 }}>
          <button className="btn btn-secondary" onClick={() => navigate("/")}>Go home</button>
        </div>
      </div>
    );
  }
  if (!result) return <p className="muted result">Claiming…</p>;

  const main = result.activities.find((a) => a.type !== "byo");
  const byo = result.activities.find((a) => a.type === "byo");
  const parts = [
    result.low_carbon && main ? `Low-carbon meal +${main.points}` : null,
    byo ? `Own container +${byo.points}` : null,
  ].filter(Boolean);

  return (
    <div className="result">
      <svg className="check" width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
        <circle cx="46" cy="46" r="40" fill="none" stroke="var(--accent)" strokeWidth="5" />
        <path d="M30 47 l11 11 l21 -23" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="num-xl" style={{ marginTop: 8 }}>{result.points > 0 ? `+${result.points}` : "Logged"}</div>
      <div className="title" style={{ fontSize: 20 }}>{result.item_name}</div>
      <div className="muted">
        {result.stall_name}
        {result.kg_co2e != null && ` · ${result.kg_co2e} kg CO₂e`}
      </div>
      {parts.length > 0 && (
        <div className="muted" style={{ borderTop: "0.5px solid var(--line)", paddingTop: 12, marginTop: 4, color: "var(--text-2)" }}>
          {parts.join(" · ")}
        </div>
      )}
      <div style={{ width: "100%", marginTop: 28 }}>
        <button className="btn" onClick={() => navigate("/")}>Done</button>
      </div>
    </div>
  );
}
