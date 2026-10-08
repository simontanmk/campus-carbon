import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

type Payload = { settings: Record<string, number>; missions: { id: string; name: string; points: number; default_points: number }[] };

const LABELS: Record<string, string> = {
  points_meal_low_carbon: "Low-carbon stall meal",
  points_byo: "Own cup or container",
  points_photo_low_carbon: "Photo meal (low-carbon)",
  points_walk_trip: "Walk trip",
  points_shuttle_trip: "Shuttle trip",
  points_container_return: "Container return (each)",
  self_reported_daily_cap: "Daily cap on self-reported points",
  receipt_daily_cap: "Daily cap on receipt-backed returns",
  rate_stall_window_min: "Minutes between claims at one stall",
  rate_daily_max: "Stall claims per day",
  token_ttl_sec: "Code lifetime (seconds)",
};

export function AdminSettings() {
  const [data, setData] = useState<Payload | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (p: Payload) => {
    setData(p);
    setValues({
      ...Object.fromEntries(Object.entries(p.settings).map(([k, v]) => [k, String(v)])),
      ...Object.fromEntries(p.missions.map((m) => [`mission_points_${m.id}`, String(m.points)])),
    });
  };
  useEffect(() => { api<Payload>("/admin/settings").then(apply).catch(() => setError("Admins only. Switch back to the admin account.")); }, []);

  async function save() {
    setError(null);
    setNote(null);
    try {
      const out = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]));
      apply(await api<Payload>("/admin/settings", { values: out }));
      setNote("Saved. New values apply immediately.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : null;
  const field = (key: string, label: string) => (
    <div className="row" key={key} style={{ alignItems: "center" }}>
      <span className="what" style={{ fontSize: 15 }}>{label}</span>
      <input type="text" inputMode="numeric" value={values[key] ?? ""} onChange={(e) => setValues({ ...values, [key]: e.target.value.replace(/\D/g, "") })} style={{ width: 96, textAlign: "right" }} aria-label={label} />
    </div>
  );

  return (
    <>
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="display" style={{ marginTop: 8 }}>Points and limits.</h1>
      </div>
      {error && <p className="error">{error}</p>}
      {note && <div className="toast" role="status">{note}</div>}
      <div>
        <div className="section-head">Points, caps and limits</div>
        <div className="list">{Object.keys(LABELS).map((k) => field(k, LABELS[k]))}</div>
      </div>
      <div>
        <div className="section-head">Mission rewards</div>
        <div className="list">{data.missions.map((m) => field(`mission_points_${m.id}`, m.name))}</div>
      </div>
      <button className="btn" onClick={save}>Save</button>
    </>
  );
}
