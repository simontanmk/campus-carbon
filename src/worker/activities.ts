export type NewActivity = {
  user_id: string;
  category: "food" | "mobility" | "waste";
  type: "meal" | "drink" | "byo" | "trip" | "steps" | "container_return";
  kg_co2e: number | null;
  points: number;
  verified: boolean;
  source: "qr" | "nfc" | "manual" | "photo";
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
