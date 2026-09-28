export type Role = "student" | "seller" | "admin";
export type User = { id: string; display_name: string; role: Role; stall_id: string | null };
export type Me = { user: User | null; can_switch: boolean };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "unknown", data.message ?? "Something went wrong.");
  return data as T;
}
