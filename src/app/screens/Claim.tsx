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
      .catch((e) => setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again."));
  }, []);

  if (error) {
    return (
      <div className="card">
        <h2>Couldn't claim</h2>
        <p className="error">{error}</p>
        <button className="btn btn-secondary" onClick={() => navigate("/")}>Go home</button>
      </div>
    );
  }
  if (!result) return <p className="muted">Claiming…</p>;

  const byo = result.activities.find((a) => a.type === "byo");
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <div className="big-number">+{result.points}</div>
      <p>{result.item_name}</p>
      <p className="muted">
        {result.stall_name} · {result.kg_co2e == null ? "—" : `${result.kg_co2e} kg CO₂e`}
      </p>
      {result.low_carbon && <p><span className="pill pill-green">Low-carbon meal</span></p>}
      {byo && <p className="muted">Includes +{byo.points} for bringing your own container</p>}
      <button className="btn" onClick={() => navigate("/")}>Done</button>
    </div>
  );
}
