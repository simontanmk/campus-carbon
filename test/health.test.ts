import { describe, expect, it } from "vitest";
import { app } from "../src/worker/app";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await app.request("/api/health", {}, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns a JSON 404 for unknown API paths", async () => {
    const res = await app.request("/api/nope", {}, {});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Not found." });
  });
});
