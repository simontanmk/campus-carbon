export type Role = "student" | "seller" | "admin";
export type User = { id: string; display_name: string; role: Role; stall_id: string | null };
export type Me = { user: User | null; can_switch: boolean };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** `fresh` skips the browser's HTTP cache (for polls of endpoints that send Cache-Control). */
export async function api<T>(path: string, body?: unknown, opts: { fresh?: boolean } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    cache: opts.fresh ? "no-store" : undefined,
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "unknown", data.message ?? "Something went wrong.");
  return data as T;
}
