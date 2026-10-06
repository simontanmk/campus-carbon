import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api } from "../api";
import { pct, weekLabel } from "../copy";
import { navigate } from "../router";

type Week = { week_start: number; low_carbon_share: number | null; kg_saved: number };
type ImpactData = {
  generated_at: number; avg_meal_kg: number | null; kg_saved: number; low_carbon_share: number | null; verified_meals: number;
  active_students: number; walk_trips: number; byo: number; under_budget: { students: number; of: number; kg_below: number } | null; weeks: Week[];
};

/** Public projector page: campus totals only, refreshed every 30 s. */
export function Impact() {
  const [d, setD] = useState<ImpactData | null>(null);
  const [failed, setFailed] = useState(false);
  const [qr, setQr] = useState("");

  useEffect(() => {
    const load = () => api<ImpactData>("/impact", undefined, { fresh: true }).then((x) => { setD(x); setFailed(false); }).catch(() => setFailed(true));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    QRCode.toDataURL(`${location.origin}/`, { margin: 1, width: 240 }).then(setQr).catch(() => {});
  }, []);

  if (!d) return <div className="impact">{failed && <p className="error">Couldn't load campus totals. Retrying…</p>}</div>;
  const updated = new Date(d.generated_at).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" });

  return (
    <div className="impact">
      <div className="eyebrow">This week on campus</div>
      <h1 className="impact-headline">≈ {d.kg_saved} kg CO₂e saved</h1>
      <p className="muted">
        Estimated, vs an average meal on today's campus menu{d.avg_meal_kg != null ? ` (${d.avg_meal_kg} kg)` : ""}, from {d.verified_meals} stall-verified {d.verified_meals === 1 ? "meal" : "meals"}.
      </p>
      {d.under_budget && (
        <p className="body">
          {d.under_budget.students} of {d.under_budget.of} students stayed under their personal budget last week · {d.under_budget.kg_below} kg below target
        </p>
      )}

      <div className="impact-figures">
        <div className="panel"><div className="num">{pct(d.low_carbon_share)}</div><div className="label">of verified meals were low-carbon</div></div>
        <div className="panel"><div className="num">{d.active_students}</div><div className="label">students taking part</div></div>
        <div className="panel"><div className="num">{d.walk_trips}</div><div className="label">campus trips walked</div></div>
        <div className="panel"><div className="num">{d.byo}</div><div className="label">own cups and containers</div></div>
      </div>

      <div>
        <div className="section-head">Low-carbon share and kg saved, last 8 weeks</div>
        <WeekBars weeks={d.weeks} />
      </div>

      <div className="impact-foot">
        <div>
          <div className="title" style={{ fontSize: 18 }}>Campus Carbon</div>
          <div className="muted">NTU CC0006 pilot · updated {updated}</div>
          <button className="link-btn" style={{ marginTop: 8 }} onClick={() => navigate("/")}>Open Campus Carbon</button>
        </div>
        {qr && <img src={qr} alt="QR code to open Campus Carbon" width={96} height={96} />}
      </div>
    </div>
  );
}

function WeekBars({ weeks }: { weeks: Week[] }) {
  const W = 40;
  const H = 90;
  return (
    <svg className="week-bars" viewBox={`0 0 ${weeks.length * W} ${H + 46}`} role="img" aria-label="Weekly low-carbon share and kg saved">
      {weeks.map((w, i) => {
        const h = w.low_carbon_share == null ? 2 : Math.max(2, w.low_carbon_share * H);
        return (
          <g key={w.week_start} transform={`translate(${i * W + 6},0)`}>
            <rect x={0} y={H - h} width={W - 12} height={h} rx={4} fill={w.low_carbon_share == null ? "var(--line)" : "var(--accent)"} />
            <text x={(W - 12) / 2} y={H + 13} textAnchor="middle" fontSize="9" fill="var(--muted)">{weekLabel(w.week_start)}</text>
            <text x={(W - 12) / 2} y={H + 26} textAnchor="middle" fontSize="9" fill="var(--text-2)">{pct(w.low_carbon_share)}</text>
            <text x={(W - 12) / 2} y={H + 38} textAnchor="middle" fontSize="8" fill="var(--accent)">{w.kg_saved} kg</text>
          </g>
        );
      })}
    </svg>
  );
}
