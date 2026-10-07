import { describe, expect, it, vi } from "vitest";
import { CAMERA_BLOCKED, CAMERA_ENDED, CAMERA_FAILED, runScanner, SCANNER_LOAD_FAILED, type ScanDeps } from "../src/app/scanner";

const tick = () => new Promise((r) => setTimeout(r, 5));
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}
function fakes(over: Partial<ScanDeps> = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const deps: ScanDeps = {
    loadDecoder: async () => () => null,
    openCamera: vi.fn(async () => stream),
    attach: async () => {},
    grab: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    onCode: vi.fn(),
    onError: vi.fn(),
    every: 1,
    ...over,
  };
  return { deps, track, stream };
}

describe("runScanner", () => {
  it("never opens the camera if closed while the decoder is still loading", async () => {
    const load = deferred<(d: Uint8ClampedArray, w: number, h: number) => string | null>();
    const { deps } = fakes({ loadDecoder: () => load.promise });
    const stop = runScanner(deps);
    stop();
    load.resolve(() => null);
    await tick();
    expect(deps.openCamera).not.toHaveBeenCalled();
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("turns the camera off if closed while permission was pending", async () => {
    const cam = deferred<{ getTracks(): { stop(): void }[] }>();
    const { deps, track, stream } = fakes();
    deps.openCamera = vi.fn(() => cam.promise);
    const stop = runScanner(deps);
    await tick();
    stop();
    cam.resolve(stream);
    await tick();
    expect(track.stop).toHaveBeenCalled();
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("stays quiet about errors that arrive after it was closed", async () => {
    const play = deferred<void>();
    const { deps, track } = fakes({ attach: () => play.promise });
    const stop = runScanner(deps);
    await tick();
    stop();
    play.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await tick();
    expect(deps.onError).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it("reports one code and stops, even if the QR stays in view", async () => {
    const { deps, track } = fakes({ loadDecoder: async () => () => "ABCDEF" });
    runScanner(deps);
    await tick();
    await tick();
    expect(deps.onCode).toHaveBeenCalledTimes(1);
    expect(deps.onCode).toHaveBeenCalledWith("ABCDEF");
    expect(track.stop).toHaveBeenCalled();
  });

  it("explains a blocked or missing camera", async () => {
    const blocked = fakes({ openCamera: vi.fn(async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }); }) });
    runScanner(blocked.deps);
    const missing = fakes({ openCamera: vi.fn(async () => { throw new TypeError("mediaDevices is undefined"); }) });
    runScanner(missing.deps);
    await tick();
    expect(blocked.deps.onError).toHaveBeenCalledWith(CAMERA_BLOCKED);
    expect(missing.deps.onError).toHaveBeenCalledWith(CAMERA_FAILED);
  });
});

describe("runScanner: stopped camera and failed download", () => {
  it("says so when the phone stops the camera mid-scan (lock, app switch)", async () => {
    const listeners: Record<string, () => void> = {};
    const track = { stop: vi.fn(), addEventListener: (ev: string, fn: () => void) => (listeners[ev] = fn) };
    const { deps } = fakes({ openCamera: vi.fn(async () => ({ getTracks: () => [track] })) });
    runScanner(deps);
    await tick();
    listeners.ended();
    expect(deps.onError).toHaveBeenCalledWith(CAMERA_ENDED);
    expect(track.stop).toHaveBeenCalled();
  });

  it("tells a seller with an out-of-date page to reload, not to fix the camera", async () => {
    const { deps } = fakes({ loadDecoder: async () => { throw new TypeError("Failed to fetch dynamically imported module"); } });
    runScanner(deps);
    await tick();
    expect(deps.onError).toHaveBeenCalledWith(SCANNER_LOAD_FAILED);
    expect(deps.openCamera).not.toHaveBeenCalled();
  });
});
