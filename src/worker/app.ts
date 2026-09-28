import { Hono } from "hono";
import type { AppEnv } from "./env";

export const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

app.notFound((c) => c.json({ error: "not_found", message: "Not found." }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
});
