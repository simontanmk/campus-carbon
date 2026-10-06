import { missionPoints, type Act, type MissionPoints } from "./missions.ts";

export type Entry = { user_id: string; display_name: string; points: number };
export type Ranked = Entry & { rank: number };

export function rank(entries: Entry[]): Ranked[] {
  const sorted = entries
    .filter((e) => e.points > 0)
    .sort((a, b) => b.points - a.points || a.display_name.localeCompare(b.display_name));
  let prevPoints = -1;
  let prevRank = 0;
  return sorted.map((e, i) => {
    if (e.points !== prevPoints) {
      prevRank = i + 1;
      prevPoints = e.points;
    }
    return { ...e, rank: prevRank };
  });
}

export function periodPoints(acts: Act[], from: number, to: number, points?: MissionPoints): number {
  const activity = acts.reduce((n, a) => (a.created_at >= from && a.created_at < to ? n + a.points : n), 0);
  return activity + missionPoints(acts, from, to, points);
}
