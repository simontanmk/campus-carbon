import { sgDayStart } from "./lib/time";

export type NewActivity = {
  user_id: string;
  category: "food" | "mobility" | "waste";
  type: "meal" | "drink" | "byo" | "trip" | "steps" | "container_return";
  kg_co2e: number | null;
  points: number;
  verified: boolean;
  source: "qr" | "nfc" | "manual" | "photo" | "receipt";
  token_id?: string | null;
  stall_id?: string | null;
  item_id?: string | null;
  low_carbon?: boolean | null;
  image_hash?: string | null;
  detail?: Record<string, unknown>;
  created_at: number;
};

export function insertActivity(db: D1Database, a: NewActivity): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activities (id, user_id, category, type, kg_co2e, points, verified, source, token_id, stall_id, item_id, low_carbon, image_hash, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      a.user_id,
      a.category,
      a.type,
      a.kg_co2e,
      a.points,
      a.verified ? 1 : 0,
      a.source,
      a.token_id ?? null,
      a.stall_id ?? null,
      a.item_id ?? null,
      a.low_carbon == null ? null : a.low_carbon ? 1 : 0,
      a.image_hash ?? null,
      JSON.stringify(a.detail ?? {}),
      a.created_at,
    );
}

/**
 * Inserts a self-reported activity with its points capped against what the student has
 * already earned today, in one statement, so concurrent requests can't both slip under the cap.
 * Receipt-backed returns have a cap of their own: each kind counts only its own rows today.
 * Returns the points actually awarded.
 */
export async function insertCapped(
  db: D1Database,
  a: {
    user_id: string;
    category: "food" | "mobility" | "waste";
    type: "meal" | "trip" | "container_return";
    kg_co2e: number | null;
    detail: Record<string, unknown>;
    source?: "manual" | "photo" | "receipt";
    low_carbon?: boolean | null;
    image_hash?: string | null;
    receipt_key?: string | null;
  },
  full: number,
  cap: number,
  now: number,
): Promise<number> {
  const points = await db
    .prepare(
      `INSERT INTO activities (id, user_id, category, type, kg_co2e, points, verified, source, low_carbon, image_hash, receipt_key, detail_json, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5,
              MAX(0, MIN(?6, ?7 - COALESCE((SELECT SUM(points) FROM activities
                WHERE user_id = ?2 AND verified = 0 AND (source = 'receipt') = (?9 = 'receipt') AND created_at >= ?8), 0))),
              0, ?9, ?10, ?11, ?14, ?12, ?13
       RETURNING points`,
    )
    .bind(
      crypto.randomUUID(), a.user_id, a.category, a.type, a.kg_co2e, full, cap, sgDayStart(now),
      a.source ?? "manual", a.low_carbon == null ? null : a.low_carbon ? 1 : 0, a.image_hash ?? null, JSON.stringify(a.detail), now, a.receipt_key ?? null,
    )
    .first<number>("points");
  return points ?? 0;
}
