import { describe, expect, it, vi } from "vitest";
import { aiJson } from "../src/worker/lib/ai";

const env = { AI_MODE: "live", AI_BASE_URL: "https://ai.test/v1/", AI_MODEL: "primary", AI_FALLBACK_MODEL: "backup", AI_API_KEY: "k" };
const isOk = (raw: unknown) => (raw && typeof raw === "object" && (raw as any).ok === true ? (raw as { ok: true }) : null);
const mock = () => ({ ok: true as const, mock: true });
const reply = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { "content-type": "application/json" } });

describe("aiJson", () => {
  it("uses the mock when AI_MODE is not live, without calling fetch", async () => {
    const f = vi.fn();
    expect(await aiJson({}, { instructions: "i", text: "t" }, isOk, mock, f)).toEqual({ value: { ok: true, mock: true }, source: "mock" });
    expect(f).not.toHaveBeenCalled();
  });

  it("uses the mock when the key is missing", async () => {
    const f = vi.fn();
    expect((await aiJson({ ...env, AI_API_KEY: "" }, { instructions: "i", text: "t" }, isOk, mock, f)).source).toBe("mock");
    expect(f).not.toHaveBeenCalled();
  });

  it("returns the primary model's validated JSON", async () => {
    const f = vi.fn(async () => reply('{"ok":true}'));
    expect(await aiJson(env, { instructions: "i", text: "t" }, isOk, mock, f as any)).toEqual({ value: { ok: true }, source: "live" });
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe("https://ai.test/v1/chat/completions");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("primary");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(init.headers.authorization).toBe("Bearer k");
  });

  it("sends an image as a data URL next to the text", async () => {
    const f = vi.fn(async () => reply('{"ok":true}'));
    await aiJson(env, { instructions: "i", text: "t", image: { mime: "image/jpeg", base64: "QUJD" } }, isOk, mock, f as any);
    const user = JSON.parse((f.mock.calls[0] as any)[1].body).messages[1];
    expect(user.content).toEqual([{ type: "text", text: "t" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } }]);
  });

  it("falls back to the second model on a 503", async () => {
    const f = vi.fn().mockResolvedValueOnce(reply("{}", 503)).mockResolvedValueOnce(reply('{"ok":true}'));
    expect((await aiJson(env, { instructions: "i", text: "t" }, isOk, mock, f as any)).source).toBe("live");
    expect(JSON.parse((f.mock.calls[1] as any)[1].body).model).toBe("backup");
  });

  it("strips a ```json fence", async () => {
    const f = vi.fn(async () => reply('```json\n{"ok":true}\n```'));
    expect((await aiJson(env, { instructions: "i", text: "t" }, isOk, mock, f as any)).source).toBe("live");
  });

  it.each([
    ["non-JSON", () => reply("sure! here you go")],
    ["wrong shape", () => reply('{"ok":"yes"}')],
    ["network error", () => Promise.reject(new Error("boom"))],
    ["empty body", () => Promise.resolve(new Response("", { status: 200 }))],
  ])("falls back to the mock after both models fail (%s)", async (_n, make) => {
    const f = vi.fn(make as any);
    expect(await aiJson(env, { instructions: "i", text: "t" }, isOk, mock, f as any)).toEqual({ value: { ok: true, mock: true }, source: "mock" });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
