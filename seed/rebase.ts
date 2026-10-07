import { sgDayStart } from "../src/worker/lib/time.ts";
import { PERSONA_HISTORY } from "./data.ts";

const DAY = 86_400_000;

/**
 * Moves the demo personas (and only their seeded history) so they joined two weeks before `now`,
 * keeping every entry's spacing. Nothing is deleted; rehearsal rows and other accounts are untouched.
 * Activities move first, measured against the persona's current created_at, then created_at itself.
 */
export function buildRebaseSql(now: number): string {
  const target = sgDayStart(now) - 14 * DAY;
  const out: string[] = [];
  for (const uid of Object.keys(PERSONA_HISTORY)) {
    const id = uid.replace(/'/g, "''");
    out.push(
      `UPDATE activities SET created_at = created_at + (${target} - (SELECT created_at FROM users WHERE id = '${id}')) WHERE user_id = '${id}' AND id LIKE 'seed-%';`,
      `UPDATE users SET created_at = ${target} WHERE id = '${id}';`,
    );
  }
  return out.join("\n") + "\n";
}
