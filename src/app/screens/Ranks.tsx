import { useEffect, useState } from "react";
import { api } from "../api";
import { ordinal } from "../copy";

type Data = { top: { rank: number; display_name: string; points: number; me: boolean }[]; me: { rank: number | null; points: number } };

export function Ranks() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Data>("/leaderboard").then(setData).catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="error">Couldn't load the ranking. Reload to try again.</p>;
  if (!data) return null;
  const meListed = data.top.some((r) => r.me);

  return (
    <>
      <div>
        <div className="eyebrow">This week</div>
        <h1 className="display" style={{ marginTop: 8 }}>
          {data.me.rank ? `You're ${ordinal(data.me.rank)} this week.` : "Earn points to join this week's ranking."}
        </h1>
      </div>
      {data.top.length === 0 ? (
        <p className="body">No one has points yet this week. Be the first.</p>
      ) : (
        <div className="list">
          {data.top.map((r, i) => (
            <div key={i} className={r.me ? "rank-row me" : "rank-row"}>
              <span className="pos">{r.rank}</span>
              <span className="who">{r.display_name}</span>
              <span className="pts">{r.points}</span>
            </div>
          ))}
          {!meListed && data.me.rank && (
            <div className="rank-row me">
              <span className="pos">{data.me.rank}</span>
              <span className="who">You</span>
              <span className="pts">{data.me.points}</span>
            </div>
          )}
        </div>
      )}
      <p className="muted">Points from meals, your own cup, trips, returns and mission bonuses. Resets every Monday.</p>
    </>
  );
}
