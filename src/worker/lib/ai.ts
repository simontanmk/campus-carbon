export type AiEnv = { AI_MODE?: string; AI_BASE_URL?: string; AI_MODEL?: string; AI_FALLBACK_MODEL?: string; AI_API_KEY?: string };
export type AiRequest = { instructions: string; text: string; image?: { mime: string; base64: string } };

const TIMEOUT_MS = 8000;

function stripFence(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

/**
 * One JSON-producing AI call. Tries AI_MODEL, then AI_FALLBACK_MODEL; any failure (HTTP error, timeout,
 * non-JSON, or a shape `validate` rejects) moves on. If nothing valid comes back, returns the mock.
 */
export async function aiJson<T>(
  env: AiEnv,
  req: AiRequest,
  validate: (raw: unknown) => T | null,
  mock: () => T,
  fetchImpl: typeof fetch = fetch,
): Promise<{ value: T; source: "live" | "mock" }> {
  if (env.AI_MODE !== "live" || !env.AI_API_KEY || !env.AI_BASE_URL) return { value: mock(), source: "mock" };
  const url = `${env.AI_BASE_URL.replace(/\/+$/, "")}/chat/completions`;
  const user = req.image
    ? [{ type: "text", text: req.text }, { type: "image_url", image_url: { url: `data:${req.image.mime};base64,${req.image.base64}` } }]
    : req.text;
  for (const model of [env.AI_MODEL, env.AI_FALLBACK_MODEL].filter((m): m is string => !!m)) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${env.AI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: req.instructions }, { role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") continue;
      const value = validate(JSON.parse(stripFence(content)));
      if (value !== null) return { value, source: "live" };
    } catch {
      // timeout, network error or bad JSON: try the next model
    }
  }
  return { value: mock(), source: "mock" };
}
