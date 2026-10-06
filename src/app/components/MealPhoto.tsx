import { useRef, useState } from "react";
import { api, ApiError } from "../api";
import { resizeToJpeg } from "../image";

type Estimate = { dish: string; parts: Record<string, number>; kg_co2e: number | null; low_carbon: boolean; points: number; image_hash: string; source: "live" | "mock"; ticket: string };

/**
 * Photo of a meal from a stall without a code: camera → AI estimate → confirm.
 * Self-contained so Today and Log can both offer it.
 */
export function MealPhoto({ label = "Take a photo", primary = false, onLogged }: { label?: string; primary?: boolean; onLogged?: (message: string) => void }) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false); // state lags a fast double-tap; the ref flips synchronously

  async function run(fn: () => Promise<string | null>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="section" style={{ paddingTop: 0 }}>
      {note && <div className="toast" role="status">{note}</div>}
      {error && <p className="error">{error}</p>}
      {!estimate ? (
        <label className={primary ? "btn file-btn" : "btn btn-secondary file-btn"} aria-disabled={busy}>
          {busy ? "Reading your photo…" : label}
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
                setEstimate(await api<Estimate>("/meals/photo", { image: await resizeToJpeg(file) }));
                return null;
              });
            }}
          />
        </label>
      ) : (
        <div className="estimate">
          <span className="tag">{estimate.source === "mock" ? "Offline estimate" : "AI estimate"} · self-reported</span>
          <input
            type="text"
            aria-label="Dish name"
            value={estimate.dish}
            maxLength={80}
            onChange={(e) => setEstimate({ ...estimate, dish: e.target.value })}
            style={{ fontFamily: "var(--serif)", fontSize: 20, padding: "8px 12px" }}
          />
          <span className="tag">Fix the name if it's wrong. Points and kg come from the photo estimate.</span>
          <div className="muted">
            {estimate.kg_co2e == null ? "kg unknown" : `${estimate.kg_co2e} kg CO₂e`}
            {estimate.low_carbon ? " · low-carbon" : ""} · {estimate.points > 0 ? `+${estimate.points}` : "0 points"}
          </div>
          <div className="inline">
            <button className="btn btn-secondary" disabled={busy} onClick={() => setEstimate(null)}>Cancel</button>
            <button
              className="btn"
              disabled={busy || estimate.dish.trim() === ""}
              onClick={() =>
                run(async () => {
                  const r = await api<{ points: number; capped: boolean }>("/meals/photo/confirm", { dish: estimate.dish, parts: estimate.parts, image_hash: estimate.image_hash, ticket: estimate.ticket });
                  setEstimate(null);
                  const pts = r.capped ? (r.points > 0 ? `+${r.points}, daily limit reached` : "daily limit reached") : `+${r.points}`;
                  const message = `Meal logged · ${pts}`;
                  if (!onLogged) return message;
                  onLogged(message);
                  return null;
                })
              }
            >
              Log meal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
