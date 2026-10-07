import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { mmss, redeemBlock, showCode } from "../copy";

type Reward = { id: string; name: string; cost: number; stall_name: string | null; left_this_week: number | null; affordable: boolean };
type Active = { id: string; code: string; reward_name: string; cost: number; expires_at: number; server_now: number };
type Data = {
  balance: number; earned: number; spent: number; rewards: Reward[]; active: Active | null;
  history: { reward_name: string; cost: number; redeemed_at: number; stall_name: string | null }[];
};

const day = (ms: number) => new Date(ms).toLocaleDateString("en-SG", { day: "numeric", month: "short", timeZone: "Asia/Singapore" });

export function Rewards() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inFlight = useRef(false); // a fast double-tap must not ask for two codes
  const load = useCallback(() => api<Data>("/rewards").then(setD).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load rewards.")), []);
  useEffect(() => {
    load();
  }, [load]);

  async function redeem(r: Reward) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setDone(null);
    try {
      await api(`/rewards/${r.id}/redeem`, {});
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't make a code. Try again.");
    } finally {
      inFlight.current = false;
    }
  }

  if (!d) return error ? <p className="error">{error}</p> : null;
  return (
    <>
      <div>
        <div className="eyebrow">Rewards</div>
        <div className="num-xl" style={{ marginTop: 8 }}>{d.balance}</div>
        <div className="label">points to spend</div>
        <p className="muted" style={{ marginTop: 8 }}>Earned {d.earned} · spent {d.spent}. Spending doesn't change your rank.</p>
      </div>
      {done && <div className="toast" role="status">{done}</div>}
      {error && <p className="error">{error}</p>}
      {d.active && (
        <LiveCode
          key={d.active.id}
          active={d.active}
          onEnd={(redeemed) => {
            if (redeemed) setDone(`Redeemed ✓ ${d.active!.reward_name}`);
            load();
          }}
        />
      )}
      <div className="list">
        {d.rewards.map((r) => {
          const block = redeemBlock(r, d.balance, !!d.active);
          return (
            <div className="row" key={r.id} style={{ alignItems: "center" }}>
              <span className="what">
                {r.name}
                <div className="muted">
                  {r.stall_name ?? "Any stall"} · {r.cost} points{r.left_this_week != null ? ` · ${r.left_this_week} left this week` : ""}
                </div>
              </span>
              <span style={{ textAlign: "right" }}>
                <button className="link-btn" disabled={!!block} onClick={() => redeem(r)} style={block ? { opacity: 0.5 } : undefined}>Redeem</button>
                {block && !d.active && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{block}</div>}
              </span>
            </div>
          );
        })}
      </div>
      {d.history.length > 0 && (
        <>
          <div className="section-head">Redeemed</div>
          <div className="list">
            {d.history.map((h, i) => (
              <div className="row" key={i}>
                <span className="what">{h.reward_name}<div className="muted">{day(h.redeemed_at)}{h.stall_name ? ` · ${h.stall_name}` : ""}</div></span>
                <span className="muted">−{h.cost}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function LiveCode({ active, onEnd }: { active: Active; onEnd: (redeemed: boolean) => void }) {
  // Count down on this device's clock from the server's remaining time (a skewed clock can't shift it).
  const [localExpires] = useState(() => Date.now() + (active.expires_at - active.server_now));
  const [now, setNow] = useState(Date.now());
  const ended = useRef(false);
  const end = useCallback((redeemed: boolean) => {
    if (ended.current) return;
    ended.current = true;
    onEnd(redeemed);
  }, [onEnd]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      api<{ status: string }>(`/rewards/redemptions/${active.id}`)
        .then((s) => s.status !== "pending" && end(s.status === "redeemed"))
        .catch(() => {});
    }, 2000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [active.id, end]);

  const left = Math.ceil((localExpires - now) / 1000);
  useEffect(() => {
    if (left <= 0) end(false);
  }, [left, end]);

  async function cancel() {
    try {
      await api(`/rewards/redemptions/${active.id}/cancel`, {});
    } finally {
      end(false);
    }
  }

  return (
    <div className="card" style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="eyebrow">{active.reward_name} · {active.cost} points</div>
      <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 44, letterSpacing: "0.08em" }}>{showCode(active.code)}</div>
      <div className="muted">Show this to the seller · <span style={{ fontVariantNumeric: "tabular-nums" }}>{mmss(left)}</span> left</div>
      <button className="link-btn" style={{ alignSelf: "center" }} onClick={cancel}>Cancel</button>
    </div>
  );
}
