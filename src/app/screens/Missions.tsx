import { useEffect, useState } from "react";
import { api } from "../api";

type Mission = { id: string; name: string; target: number; points: number; progress: number; completed: boolean };
type Badge = { id: string; name: string; rule: string; earned_at: number | null };
type Data = { streak: number; daily: Mission[]; weekly: Mission[]; badges: Badge[] };

const date = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", timeZone: "Asia/Singapore" });

function List({ title, items }: { title: string; items: Mission[] }) {
  return (
    <div>
      <div className="section-head">{title}</div>
      <div className="panel" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {items.map((m) => (
          <div key={m.id} className={m.completed ? "mission done" : "mission"}>
            <div className="top">
              <span>{m.name}</span>
              <span className="reward">{m.completed ? "Done" : `+${m.points}`}</span>
            </div>
            <div className="progress" aria-label={`${m.progress} of ${m.target}`}>
              <i style={{ width: `${(m.progress / m.target) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Missions() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Data>("/missions").then(setData).catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="error">Couldn't load missions. Reload to try again.</p>;
  if (!data) return null;
  const earned = data.badges.filter((b) => b.earned_at != null).length;

  return (
    <>
      <div>
        <div className="eyebrow">Missions</div>
        <h1 className="display" style={{ marginTop: 8 }}>
          {data.streak > 0 ? `${data.streak}-day streak.` : "Log anything today to start a streak."}
        </h1>
      </div>
      <List title="Today" items={data.daily} />
      <List title="This week" items={data.weekly} />
      <div>
        <div className="section-head">Badges · {earned} of {data.badges.length}</div>
        <div className="badges" style={{ marginTop: 8 }}>
          {data.badges.map((b) => (
            <div key={b.id} className={b.earned_at != null ? "badge" : "badge locked"}>
              <div className="name">{b.name}</div>
              <div className="badge-rule">{b.earned_at != null ? `Earned ${date.format(b.earned_at)}` : b.rule}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
