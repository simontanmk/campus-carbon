import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function fail(c: Context, status: ContentfulStatusCode, error: string, message: string) {
  return c.json({ error, message }, status);
}

/** The JSON body as a plain object; anything else (invalid JSON, null, arrays, primitives) becomes {}. */
export async function readBody(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
