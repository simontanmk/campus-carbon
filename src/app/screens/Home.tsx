import { useEffect, useState } from "react";
import { api, type User } from "../api";

type Summary = {
  points_total: number;
  points_week: number;
  recent: { type: string; points: number; kg_co2e: number | null; low_carbon: boolean | null; verified: boolean; item_name: string | null; created_at: number }[];
};

const LABEL: Record<string, string> = { meal: "Meal", drink: "Drink", byo: "Brought own container" };

export function Home({ user }: { user: User }) {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => {
    api<Summary>("/me/summary").then(setData).catch(() => setData(null));
  }, []);

  return (
    <>
      <h1>Hi, {user.display_name}</h1>
      <div className="card">
        <p className="muted">Points this week</p>
        <div className="big-number">{data?.points_week ?? "–"}</div>
        <p className="muted">{data ? `${data.points_total} all time` : ""}</p>
      </div>
      <div className="card">
        <h2>Recent</h2>
        {data && data.recent.length === 0 && <p className="muted">Scan a stall's QR code after buying to earn points.</p>}
        <div className="list">
          {data?.recent.map((a, i) => (
            <div className="row" key={i}>
              <div>
                <div>{a.item_name ?? LABEL[a.type] ?? a.type}</div>
                <div className="muted">
                  {a.kg_co2e == null ? "—" : `${a.kg_co2e} kg CO₂e`} · {a.verified ? "verified" : "self-reported"}
                </div>
              </div>
              <span className={a.low_carbon ? "pill pill-green" : "pill"}>+{a.points}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
