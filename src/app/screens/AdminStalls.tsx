import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { formatParts, parsePartsText } from "../copy";

type Stall = { id: string; name: string; canteen: string; active: boolean; verify_method: "qr" | "nfc" | "both" };
type Item = { id: string; name: string; kind: "meal" | "drink"; parts: Record<string, number>; kg_co2e: number | null; low_carbon: boolean; status: "draft" | "live" };

export function AdminStalls() {
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [stallId, setStallId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", kind: "meal" as "meal" | "drink", parts: "" });
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const stall = stalls.find((s) => s.id === stallId) ?? null;

  const loadStalls = () => api<{ stalls: Stall[] }>("/admin/stalls").then((d) => setStalls(d.stalls));
  const loadItems = (id = stallId) => (id ? api<{ items: Item[] }>(`/admin/items?stall_id=${encodeURIComponent(id)}`).then((d) => setItems(d.items)) : Promise.resolve(setItems([])));
  useEffect(() => { loadStalls().catch(() => setError("Admins only. Switch back to the admin account.")); }, []);
  useEffect(() => { setEditing(null); loadItems().catch(() => setItems([])); }, [stallId]);

  async function run(fn: () => Promise<string | null>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setNote(null);
    try { setNote(await fn()); } catch (e) { setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again."); } finally { inFlight.current = false; }
  }

  function startEdit(i: Item | null) {
    setEditing(i ? i.id : "new");
    setDraft(i ? { name: i.name, kind: i.kind, parts: formatParts(i.parts) } : { name: "", kind: "meal", parts: "" });
  }

  function save() {
    const { parts, unknown } = parsePartsText(draft.parts);
    if (unknown.length) return setError(`Unknown ingredients: ${unknown.join(", ")}. Use: rice, wheat, poultry, pork, beef_herd, beef_dairy, fish_farmed, eggs, tofu, milk, coffee, cane_sugar, veg.`);
    run(async () => {
      if (editing === "new") await api("/admin/items", { stall_id: stallId, name: draft.name, kind: draft.kind, parts });
      else await api(`/admin/items/${editing}`, { name: draft.name, kind: draft.kind, parts });
      setEditing(null);
      await loadItems();
      return "Saved. kg recalculated from the factor table.";
    });
  }

  const stickerUrl = stall ? `${location.origin}/tap?stall=${stall.id}` : "";

  return (
    <>
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="display" style={{ marginTop: 8 }}>Stalls and items.</h1>
      </div>
      {error && <p className="error">{error}</p>}
      {note && <div className="toast" role="status">{note}</div>}
      <select value={stallId} onChange={(e) => setStallId(e.target.value)}>
        <option value="">Choose a stall</option>
        {stalls.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.canteen}</option>)}
      </select>

      {stall && (
        <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="toggle-row" style={{ borderTop: 0, padding: 0 }}>
            <span>Taking claims</span>
            <span className="switch">
              <input type="checkbox" checked={stall.active} onChange={(e) => run(async () => { await api(`/admin/stalls/${stall.id}`, { active: e.target.checked }); await loadStalls(); return null; })} aria-label="Taking claims" />
              <span />
            </span>
          </label>
          <div>
            <p className="field-label">How customers claim</p>
            <select value={stall.verify_method} onChange={(e) => run(async () => { await api(`/admin/stalls/${stall.id}`, { verify_method: e.target.value }); await loadStalls(); return null; })}>
              <option value="qr">QR code</option>
              <option value="nfc">NFC sticker</option>
              <option value="both">Both</option>
            </select>
          </div>
          {stall.verify_method !== "qr" && (
            <div>
              <p className="field-label">Write this link to the stall's NFC sticker</p>
              <div className="inline">
                <input type="text" readOnly value={stickerUrl} />
                <button className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(stickerUrl).then(() => setNote("Link copied."))}>Copy</button>
              </div>
            </div>
          )}
        </div>
      )}

      {stall && (
        <div className="list">
          {items.map((i) => (
            <div key={i.id} className="row" style={{ alignItems: "center" }}>
              <div>
                <div className="what">{i.name}</div>
                <div className="meta">{i.status} · {i.kind} · {i.kg_co2e == null ? "kg unknown" : `${i.kg_co2e} kg`}{i.low_carbon ? " · low-carbon" : ""}</div>
              </div>
              <div className="inline">
                <button className="link-btn" onClick={() => startEdit(i)}>Edit</button>
                <button className="link-btn" onClick={() => run(async () => { await api(`/admin/items/${i.id}`, { status: i.status === "live" ? "draft" : "live" }); await loadItems(); return null; })}>
                  {i.status === "live" ? "Hide" : "Approve"}
                </button>
              </div>
            </div>
          ))}
          <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={() => startEdit(null)}>Add an item</button>
        </div>
      )}

      {editing && (
        <div className="estimate">
          <span className="tag">{editing === "new" ? "New item (starts as a draft)" : "Edit item"}</span>
          <input type="text" placeholder="Name" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "meal" | "drink" })}>
            <option value="meal">Meal</option>
            <option value="drink">Drink</option>
          </select>
          <textarea
            rows={3}
            placeholder="rice 80, veg 150, eggs 50"
            value={draft.parts}
            onChange={(e) => setDraft({ ...draft, parts: e.target.value })}
            style={{ width: "100%", padding: 14, borderRadius: 14, border: "0.5px solid var(--line)", font: "inherit", fontSize: 15 }}
          />
          <p className="muted">Grams per portion. Rice and noodles dry weight.</p>
          <div className="inline">
            <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn" onClick={save}>Save</button>
          </div>
        </div>
      )}
    </>
  );
}
