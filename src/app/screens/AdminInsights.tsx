import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { pct, weekLabel } from "../copy";
import { navigate } from "../router";

type Stats = { meals: number; low_carbon_share: number | null; avg_kg: number | null; byo: number };
type Data = {
  stalls: { id: string; name: string; this_week: Stats; last_week: Stats }[];
  top_dishes: { name: string; stall_name: string | null; count: number; low_carbon: boolean }[];
  weeks: { week_start: number; verified_meals: number; low_carbon_share: number | null; photo_meals: number; trips: { walk: number; shuttle: number; car: number } }[];
};

const meals = (n: number) => `${n} ${n === 1 ? "meal" : "meals"}`;
const containers = (n: number) => `${n} own ${n === 1 ? "container" : "containers"}`;

export function AdminInsights() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Data>("/admin/insights").then(setD).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load insights."));
  }, []);

  return (
    <>
      <div>
        <button className="link-btn" onClick={() => navigate("/admin")}>‹ Admin</button>
        <h1 className="display" style={{ marginTop: 8 }}>Insights</h1>
        <p className="muted">Stall-verified meals only. <a href="/impact" style={{ color: "var(--accent)" }}>Open the public impact page</a></p>
      </div>
      {error && <p className="error">{error}</p>}
      {d && (
        <>
          <div className="section-head">Stalls this week</div>
          <div className="list">
            {d.stalls.map((s) => (
              <div className="row" key={s.id} style={{ alignItems: "flex-start" }}>
                <span className="what">
                  {s.name}
                  <div className="muted">{containers(s.this_week.byo)} · last week {meals(s.last_week.meals)}, {pct(s.last_week.low_carbon_share)} low-carbon</div>
                </span>
                <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <div>{meals(s.this_week.meals)}</div>
                  <div className="muted">{pct(s.this_week.low_carbon_share)} low-carbon</div>
                </span>
              </div>
            ))}
          </div>

          <div className="section-head">Top dishes this week</div>
          {d.top_dishes.length === 0 ? (
            <p className="muted">No verified meals yet this week.</p>
          ) : (
            <div className="list">
              {d.top_dishes.map((t) => (
                <div className="row" key={`${t.name}|${t.stall_name}`}>
                  <span className="what">{t.name}{t.stall_name && <span className="muted"> · {t.stall_name}</span>}{t.low_carbon && <span className="muted" style={{ marginLeft: 8, color: "var(--accent)" }}>Low-carbon</span>}</span>
                  <span className="pts">{t.count}</span>
                </div>
              ))}
            </div>
          )}

          <div className="section-head">Last 8 weeks</div>
          <div className="list">
            {d.weeks.slice().reverse().map((w) => (
              <div className="row" key={w.week_start}>
                <span className="what">{weekLabel(w.week_start)}</span>
                <span className="muted" style={{ textAlign: "right" }}>
                  {meals(w.verified_meals)} · {pct(w.low_carbon_share)} low · {w.photo_meals} photo · trips {w.trips.walk}/{w.trips.shuttle}/{w.trips.car}
                </span>
              </div>
            ))}
          </div>
          <p className="muted">Trips are walk / shuttle / car.</p>
        </>
      )}
    </>
  );
}
