import { Hono } from "hono";
import type { AppEnv } from "./env";
import { session } from "./session";
import { auth } from "./routes/auth";
import { stall } from "./routes/stall";
import { claim } from "./routes/claim";

export const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));
app.use("*", session);
app.route("/", auth);
app.route("/", stall);
app.route("/", claim);

app.notFound((c) => c.json({ error: "not_found", message: "Not found." }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
});
