import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { resizeToJpeg } from "../image";

type Stall = { id: string; name: string; canteen: string };
type Item = { id: string; name: string; kind: "meal" | "drink"; kg_co2e: number | null; low_carbon: boolean; status: "draft" | "live" };

export function MenuImport() {
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [stall, setStall] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    api<{ stalls: Stall[] }>("/admin/stalls").then((d) => setStalls(d.stalls)).catch(() => setError("Admins only. Switch back to the admin account."));
  }, []);
  useEffect(() => {
    if (!stall) return setItems([]);
    api<{ items: Item[] }>(`/admin/items?stall_id=${encodeURIComponent(stall)}`).then((d) => setItems(d.items)).catch(() => setItems([]));
  }, [stall]);

  async function run(fn: () => Promise<string | null>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      setNote(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const reload = async () => setItems((await api<{ items: Item[] }>(`/admin/items?stall_id=${encodeURIComponent(stall)}`)).items);

  return (
    <>
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="display" style={{ marginTop: 8 }}>Import a menu from a photo.</h1>
      </div>
      <p className="body" style={{ fontSize: 14 }}>AI suggests dishes and ingredients; kg comes from the factor table. Nothing goes live until you approve it.</p>
      {error && <p className="error">{error}</p>}
      {note && <div className="toast" role="status">{note}</div>}
      <select value={stall} onChange={(e) => setStall(e.target.value)}>
        <option value="">Choose a stall</option>
        {stalls.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.canteen}</option>)}
      </select>
      {stall && (
        <label className="btn btn-secondary file-btn">
          Photo of the menu board
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              run(async () => {
                const r = await api<{ items: Item[]; source: string }>("/admin/menu/photo", { stall_id: stall, image: await resizeToJpeg(file) });
                await reload();
                return `${r.items.length} draft${r.items.length === 1 ? "" : "s"} added${r.source === "mock" ? " (offline estimate)" : ""}.`;
              });
            }}
          />
        </label>
      )}
      <div className="list">
        {items.map((i) => (
          <div className="row" key={i.id} style={{ alignItems: "center" }}>
            <div>
              <div className="what">{i.name}</div>
              <div className="meta">
                {i.status} · {i.kind} · {i.kg_co2e == null ? "kg unknown" : `${i.kg_co2e} kg`}{i.low_carbon ? " · low-carbon" : ""}
              </div>
            </div>
            {i.status === "draft" && (
              <div className="inline">
                <button className="link-btn" disabled={busy} onClick={() => run(async () => { await api(`/admin/items/${i.id}/delete`, {}); await reload(); return null; })}>Discard</button>
                <button className="link-btn" disabled={busy} onClick={() => run(async () => { await api(`/admin/items/${i.id}`, { status: "live" }); await reload(); return `${i.name} is live.`; })}>Approve</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
