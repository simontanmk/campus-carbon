type Decode = (data: Uint8ClampedArray, width: number, height: number) => string | null;
type Stream = { getTracks(): { stop(): void }[] };

export const CAMERA_BLOCKED = "Camera blocked. Allow camera access, or type the code.";
export const CAMERA_FAILED = "Couldn't open the camera. Type the code instead.";

export type ScanDeps = {
  loadDecoder: () => Promise<Decode>;
  openCamera: () => Promise<Stream>;
  /** Show the stream in the video element and start playing it. */
  attach: (stream: Stream) => Promise<void>;
  /** The current camera frame, or null before the video has a size. */
  grab: () => { data: Uint8ClampedArray; width: number; height: number } | null;
  onCode: (code: string) => void;
  onError: (message: string) => void;
  every?: number;
};

/**
 * Camera lifecycle for the seller's scanner. Returns stop(). Closing at any point (decoder still loading,
 * permission prompt open, video starting) never leaves the camera on and never reports a late error.
 */
export function runScanner(d: ScanDeps): () => void {
  let stream: Stream | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    stream?.getTracks().forEach((t) => t.stop());
  };
  (async () => {
    try {
      const decode = await d.loadDecoder();
      if (stopped) return;
      stream = await d.openCamera();
      if (stopped) return stop();
      await d.attach(stream);
      if (stopped) return;
      const scan = () => {
        if (stopped) return;
        const f = d.grab();
        const code = f ? decode(f.data, f.width, f.height) : null;
        if (code) {
          stop(); // one confirm per scan, even if the QR stays in view
          d.onCode(code);
          return;
        }
        timer = setTimeout(scan, d.every ?? 200);
      };
      scan();
    } catch (e) {
      if (stopped) return;
      stop();
      d.onError((e as Error)?.name === "NotAllowedError" ? CAMERA_BLOCKED : CAMERA_FAILED);
    }
  })();
  return stop;
}
