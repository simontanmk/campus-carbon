import { useEffect, useState } from "react";
import { api, type User } from "../api";
import { Ring } from "../components/Ring";
import { weekHeadline } from "../copy";

type Summary = {
  points_total: number;
  points_week: number;
  meals_week: number;
  low_carbon_meals_week: number;
  kg_week: number;
  recent: { type: string; points: number; kg_co2e: number | null; low_carbon: boolean | null; verified: boolean; item_name: string | null; created_at: number }[];
};

const LABEL: Record<string, string> = { meal: "Meal", drink: "Drink", byo: "Own cup or container" };
const today = new Intl.DateTimeFormat("en-SG", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Singapore" });
const when = new Intl.DateTimeFormat("en-SG", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" });

export function Home({ user }: { user: User }) {
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Summary>("/me/summary").then(setData).catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="error">Couldn't load your week. Reload to try again.</p>;

  return (
    <>
      <div>
        <div className="eyebrow">{today.format(new Date())} · {user.display_name}</div>
        <h1 className="display" style={{ marginTop: 8 }}>{data ? weekHeadline(data) : " "}</h1>
      </div>

      <div className="stats">
        <Ring value={data && data.meals_week > 0 ? data.low_carbon_meals_week / data.meals_week : 0} />
        <div className="figures">
          <div>
            <div className="num">{data?.points_week ?? "–"}</div>
            <div className="label">points this week</div>
          </div>
          <div>
            <div className="num">{data ? data.kg_week : "–"}</div>
            <div className="label">kg CO₂e logged</div>
          </div>
        </div>
      </div>

      {data && data.recent.length > 0 && (
        <div>
          <div className="section-head">Recent</div>
          <div className="list">
            {data.recent.map((a, i) => (
              <div className="row" key={i}>
                <div>
                  <div className="what">{a.item_name ?? LABEL[a.type] ?? a.type}</div>
                  <div className="meta">
                    {when.format(a.created_at)}
                    {a.kg_co2e != null && ` · ${a.kg_co2e} kg`}
                    {a.low_carbon && " · low-carbon"}
                    {!a.verified && " · self-reported"}
                  </div>
                </div>
                <span className={a.points > 0 ? "pts green" : "pts"}>{a.points > 0 ? `+${a.points}` : "0"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data && <p className="muted">{data.points_total} points all time</p>}
    </>
  );
}
