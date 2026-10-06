import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { MealPhoto } from "../components/MealPhoto";

type Place = { id: string; name: string };
type Option = { mode: "walk" | "shuttle" | "car"; minutes: number; kg_co2e: number | null; points: number };
type Options = { from: Place; to: Place; distance_km: number; options: Option[] };

const MODE = { walk: "Walk", shuttle: "Campus shuttle", car: "Car or Grab" } as const;

export function Log() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [opts, setOpts] = useState<Options | null>(null);
  const [steps, setSteps] = useState("");
  const [count, setCount] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false); // state lags a fast double-tap; the ref flips synchronously
  const [typed, setTyped] = useState("");

  useEffect(() => {
    api<{ locations: Place[] }>("/locations").then((d) => setPlaces(d.locations)).catch(() => setError("Couldn't load places."));
  }, []);

  useEffect(() => {
    setOpts(null);
    setError(null);
    if (!from || !to || from === to) return;
    let stale = false; // a slower answer for an earlier pair must not replace this one
    api<Options>(`/trips/options?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((o) => !stale && setOpts(o))
      .catch((e) => !stale && setError(e instanceof ApiError ? e.message : "Couldn't load options."));
    return () => {
      stale = true;
    };
  }, [from, to]);

  async function run(fn: () => Promise<string>) {
    if (inFlight.current) return; // one request at a time: a double-tap must not log twice
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setToast(null);
    try {
      setToast(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const pts = (p: number, capped: boolean) => (capped ? (p > 0 ? `· +${p}, daily limit reached` : "· daily limit reached") : `· +${p}`);

  return (
    <>
      <div>
        <div className="eyebrow">Self-reported</div>
        <h1 className="display" style={{ marginTop: 8 }}>Log a trip, steps, a return or a meal.</h1>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      {error && <p className="error">{error}</p>}

      <div className="section">
        <h2 className="title">Trip</h2>
        <div className="inline">
          <input type="text" placeholder="Hive to Hall 11" value={typed} maxLength={200} onChange={(e) => setTyped(e.target.value)} />
          <button
            className="btn btn-secondary"
            disabled={busy || typed.trim() === ""}
            onClick={() =>
              run(async () => {
                const r = await api<{ from_id: string; to_id: string; source: string }>("/trips/parse", { text: typed });
                setFrom(r.from_id);
                setTo(r.to_id);
                setTyped("");
                return r.source === "mock" ? "Places filled in (offline estimate). Check them below." : "Places filled in. Check them below.";
              })
            }
          >
            Find
          </button>
        </div>
        <div>
          <p className="field-label">From</p>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose a place</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <p className="field-label">To</p>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a place</option>
            {places.filter((p) => p.id !== from).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {opts && (
          <div className="options">
            <p className="muted">{opts.distance_km} km on foot · tap how you went</p>
            {opts.options.map((o) => (
              <button
                key={o.mode}
                className="option"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await api<{ points: number; capped: boolean }>("/trips", { from_id: opts.from.id, to_id: opts.to.id, mode: o.mode });
                    setFrom("");
                    setTo("");
                    return `${MODE[o.mode]} logged ${pts(r.points, r.capped)}`;
                  })
                }
              >
                <div>
                  <div className="mode">{MODE[o.mode]}</div>
                  <div className="sub">{o.minutes} min · {o.kg_co2e == null ? "factor pending" : `${o.kg_co2e} kg CO₂e`}</div>
                </div>
                <span className={o.points > 0 ? "pts green" : "pts"}>{o.points > 0 ? `+${o.points}` : "0"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <hr className="rule" />
      <div className="section">
        <h2 className="title">Steps today</h2>
        <input type="text" inputMode="numeric" placeholder="5000" value={steps} onChange={(e) => setSteps(e.target.value.replace(/\D/g, ""))} />
        <button
          className="btn btn-secondary"
          disabled={busy || steps === ""}
          onClick={() =>
            run(async () => {
              await api("/steps", { steps: Number(steps) });
              setSteps("");
              return `${Number(steps).toLocaleString("en-SG")} steps logged`;
            })
          }
        >
          Log steps
        </button>
      </div>

      <hr className="rule" />
      <div className="section">
        <h2 className="title">Container returns</h2>
        <p className="body" style={{ fontSize: 14 }}>Bottles and cans returned under the Beverage Container Return Scheme.</p>
        <div className="stepper">
          <button aria-label="Fewer" onClick={() => setCount((n) => Math.max(1, n - 1))}>−</button>
          <span className="num">{count}</span>
          <button aria-label="More" onClick={() => setCount((n) => Math.min(20, n + 1))}>+</button>
        </div>
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api<{ points: number; capped: boolean }>("/returns", { count });
              setCount(1);
              return `${count} container${count === 1 ? "" : "s"} returned ${pts(r.points, r.capped)}`;
            })
          }
        >
          Log returns
        </button>
      </div>
      <hr className="rule" />
      <div className="section">
        <h2 className="title">Meal at another stall</h2>
        <p className="body" style={{ fontSize: 14 }}>For stalls without a code. Photo meals are self-reported and earn +5 if plant or egg based.</p>
        <MealPhoto />
      </div>
    </>
  );
}
