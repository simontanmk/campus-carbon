import { app } from "../../src/worker/app";
import { sign } from "../../src/worker/lib/token";
import { buildSeedSql } from "../../seed/sql";
import { createTestD1 } from "./d1";

export async function setup() {
  const { d1, raw } = createTestD1();
  raw.exec(buildSeedSql());
  const env = { DB: d1, TOKEN_SECRET: "test-token-secret", COOKIE_SECRET: "test-cookie-secret" };

  async function req(
    path: string,
    opts: { method?: string; body?: unknown; as?: string; cookie?: string } = {},
  ) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const cookies: string[] = [];
    if (opts.as) cookies.push(`uid=${encodeURIComponent(await sign(opts.as, env.COOKIE_SECRET))}`);
    if (opts.cookie) cookies.push(opts.cookie);
    if (cookies.length) headers.cookie = cookies.join("; ");
    const res = await app.request(
      `https://app.test${path}`,
      {
        method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      },
      env,
    );
    return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
  }

  return { env, raw, req };
}

/** Turn Set-Cookie headers into a Cookie request header value. */
export function cookiesFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
