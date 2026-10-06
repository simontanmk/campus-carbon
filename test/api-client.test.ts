import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/app/api";

describe("api() fresh option", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("bypasses the browser HTTP cache when asked, so a 30 s poll always sees new numbers", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    await api("/impact", undefined, { fresh: true });
    expect((f.mock.calls[0] as any)[1].cache).toBe("no-store");
    await api("/me");
    expect((f.mock.calls[1] as any)[1].cache).toBeUndefined();
  });
});
