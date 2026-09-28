export type Bindings = {
  DB: D1Database;
  TOKEN_SECRET: string;
  COOKIE_SECRET: string;
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
