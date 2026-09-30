export type Bindings = {
  DB: D1Database;
  TOKEN_SECRET: string;
  COOKIE_SECRET: string;
  AI_MODE?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  AI_FALLBACK_MODEL?: string;
  AI_API_KEY?: string;
  /** Test seam: replaces global fetch for AI calls. */
  AI_FETCH?: typeof fetch;
};

export type Role = "student" | "seller" | "admin";

export type User = {
  id: string;
  display_name: string;
  role: Role;
  stall_id: string | null;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: { user: User | null; adminId: string | null };
};
