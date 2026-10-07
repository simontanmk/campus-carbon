import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { navigate } from "../router";

type Stall = { id: string; name: string };
type Reward = { id: string; name: string; cost: number; stall_id: string | null; stall_name: string | null; weekly_stock: number | null; active: boolean; redeemed_this_week: number; pending_now: number };
type Draft = { name: string; cost: string; stall_id: string; weekly_stock: string; active: boolean };

const toDraft = (r?: Reward): Draft => ({
  name: r?.name ?? "", cost: r ? String(r.cost) : "", stall_id: r?.stall_id ?? "",
  weekly_stock: r?.weekly_stock == null ? "" : String(r.weekly_stock), active: r?.active ?? true,
});
const toBody = (d: Draft) => ({
  name: d.name.trim(), cost: Number(d.cost), stall_id: d.stall_id || null,
  weekly_stock: d.weekly_stock.trim() === "" ? null : Number(d.weekly_stock), active: d.active,
});

export function AdminRewards() {
  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<{ rewards: Reward[] }>("/admin/rewards").then((d) => setRewards(d.rewards)).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load rewards.")), []);
  useEffect(() => {
    load();
    api<{ stalls: Stall[] }>("/admin/stalls").then((d) => setStalls(d.stalls)).catch(() => {});
  }, [load]);

  return (
    <>
      <div>
        <button className="link-btn" onClick={() => navigate("/admin")}>‹ Admin</button>
        <h1 className="display" style={{ marginTop: 8 }}>Rewards</h1>
        <p className="muted">Blank stock means unlimited. A new cost applies to codes issued after you save.</p>
      </div>
      {error && <p className="error">{error}</p>}
      {rewards?.map((r) => (
        <RewardForm key={r.id} initial={toDraft(r)} stalls={stalls} label="Save"
          note={`${r.redeemed_this_week} redeemed this week · ${r.pending_now} on hold now`}
          onSubmit={async (body) => { await api(`/admin/rewards/${r.id}`, body); await load(); }} />
      ))}
      <div className="section-head">Add a reward</div>
      <RewardForm key={`new-${rewards?.length ?? 0}`} initial={toDraft()} stalls={stalls} label="Add reward"
        onSubmit={async (body) => { await api("/admin/rewards", body); await load(); }} />
      <a className="btn btn-secondary" style={{ textAlign: "center", textDecoration: "none" }} href="/api/admin/redemptions.csv" download>Download redemptions (CSV)</a>
    </>
  );
}

function RewardForm({ initial, stalls, label, note, onSubmit }: {
  initial: Draft; stalls: Stall[]; label: string; note?: string; onSubmit: (body: ReturnType<typeof toBody>) => Promise<void>;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Draft>) => { setD({ ...d, ...patch }); setSaved(false); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(toBody(d));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input type="text" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Reward name" maxLength={60} aria-label="Reward name" />
      <div className="inline">
        <label style={{ flex: 1 }}>
          <div className="field-label">Cost (points)</div>
          <input type="number" inputMode="numeric" value={d.cost} onChange={(e) => set({ cost: e.target.value })} aria-label="Cost in points" style={{ width: "100%" }} />
        </label>
        <label style={{ flex: 1 }}>
          <div className="field-label">Weekly stock</div>
          <input type="number" inputMode="numeric" value={d.weekly_stock} onChange={(e) => set({ weekly_stock: e.target.value })} placeholder="Unlimited" aria-label="Weekly stock" style={{ width: "100%" }} />
        </label>
      </div>
      <select value={d.stall_id} onChange={(e) => set({ stall_id: e.target.value })} aria-label="Stall">
        <option value="">Any stall</option>
        {stalls.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <label className="toggle-row">
        <span>Available to students</span>
        <span className="switch"><input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} aria-label="Available to students" /><span /></span>
      </label>
      {note && <p className="muted">{note}</p>}
      {error && <p className="error">{error}</p>}
      <button className="btn" disabled={busy}>{saved ? "Saved" : label}</button>
    </form>
  );
}
