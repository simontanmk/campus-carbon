import { useEffect, useState } from "react";
import { api, type User } from "../api";
import { activityLabel, budgetLine, factHeadline, shortName, weekHeadline } from "../copy";

type Summary = {
  points_total: number;
  points_week: number;
  meals_week: number;
  low_carbon_meals_week: number;
  kg_week: number;
  days: ("low" | "other" | "none")[];
  swap: { from: string; to: string; saves_kg: number } | null;
  fact: { high: { name: string; kg: number }; low: { name: string; kg: number } } | null;
  featured: { name: string; stall_name: string; kg_co2e: number; points: number } | null;
  recent: { type: string; points: number; kg_co2e: number | null; low_carbon: boolean | null; verified: boolean; item_name: string | null; created_at: number; detail: Record<string, unknown>; place_names: { from: string; to: string } | null }[];
  budget:
    | { ready: false; reason: "first_week" | "no_baseline"; ready_at: number }
    | { ready: true; overall: Line; categories: Record<"food" | "mobility" | "waste", Line>; biggest: "food" | "mobility" | "waste" | null };
};
type Line = { target: number; used: number; remaining: number; last_week: number };

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const today = new Intl.DateTimeFormat("en-SG", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Singapore" });

export function Home({ user }: { user: User }) {
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Summary>("/me/summary").then(setData).catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="error">Couldn't load your week. Reload to try again.</p>;
  if (!data) return null;
  if (data.recent.length === 0) return <FirstVisit user={user} data={data} />;

  return (
    <>
      <div>
        <div className="eyebrow">{today.format(new Date())}</div>
        <h1 className="display" style={{ marginTop: 8 }}>{weekHeadline(data)}</h1>
      </div>

      <div className="week" aria-label="This week">
        {data.days.map((d, i) => (
          <div key={i}>
            {DAYS[i]}
            <i className={d} />
          </div>
        ))}
      </div>

      <div className="panel figures">
        <div>
          <div className="num">{data.points_week}</div>
          <div className="label">points this week</div>
        </div>
        {data.budget.ready ? (
          <div>
            <div className="num" style={data.budget.overall.remaining < 0 ? { color: "var(--danger)" } : undefined}>
              {data.budget.overall.remaining}
            </div>
            <div className="label">kg left of budget</div>
          </div>
        ) : (
          <div>
            <div className="num">{data.kg_week}</div>
            <div className="label">kg CO₂e logged</div>
          </div>
        )}
      </div>

      {data.budget.ready ? (
        <p className="muted" style={{ marginTop: -8 }}>{budgetLine(data.budget)}</p>
      ) : data.budget.reason === "first_week" ? (
        <p className="muted" style={{ marginTop: -8 }}>
          Your budget starts {new Date(data.budget.ready_at).toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Singapore" })}, based on your first week.
        </p>
      ) : null}

      {data.swap && (
        <p className="body" style={{ fontSize: 14 }}>
          Swap {shortName(data.swap.from).toLowerCase()} for {shortName(data.swap.to).toLowerCase()} to save {data.swap.saves_kg} kg next time.
        </p>
      )}

      <div className="list" style={{ borderTop: "0.5px solid var(--line)" }}>
        {data.recent.slice(0, 3).map((a, i) => (
          <div className="row" key={i}>
            <span className="what">
              {activityLabel(a)}
              {!a.verified && <span className="muted"> · self-reported</span>}
            </span>
            <span className={a.points > 0 ? "pts green" : "pts"} style={a.points > 0 ? undefined : { color: "var(--muted)" }}>
              {a.points > 0 ? `+${a.points}` : "0"}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function FirstVisit({ user, data }: { user: User; data: Summary }) {
  const { fact, featured } = data;
  return (
    <>
      <div>
        <div className="eyebrow">Welcome, {user.display_name}</div>
        <h1 className="display" style={{ marginTop: 8 }}>
          {fact ? factHeadline(fact) : "Your week starts with your next meal."}
        </h1>
      </div>

      {fact && (
        <div className="panel">
          <div className="bar-row"><span>{shortName(fact.high.name)}</span><span className="muted">{fact.high.kg} kg</span></div>
          <div className="bar" />
          <div className="bar-row" style={{ marginTop: 14 }}><span>{shortName(fact.low.name)}</span><span className="muted">{fact.low.kg} kg</span></div>
          <div className="bar green" style={{ width: `${Math.max(4, (fact.low.kg / fact.high.kg) * 100)}%` }} />
        </div>
      )}

      {featured && (
        <div className="card">
          <div className="eyebrow">Lightest plate · {featured.stall_name}</div>
          <div className="title" style={{ fontSize: 20, marginTop: 4 }}>{featured.name}</div>
          <div className="figures" style={{ marginTop: 14 }}>
            <div>
              <div className="num">{featured.kg_co2e}</div>
              <div className="label">kg CO₂e</div>
            </div>
            <div>
              <div className="num green">+{featured.points}</div>
              <div className="label">points</div>
            </div>
          </div>
        </div>
      )}

      <p className="body" style={{ fontSize: 14 }}>
        Scan the stall's code after you buy. Plant or egg dishes earn points, and bringing your own cup or container earns extra.
      </p>
    </>
  );
}
