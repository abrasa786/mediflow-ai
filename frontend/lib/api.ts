import { supabase } from "@/lib/supabase";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** fetch() to the Mediflow backend with the user's Supabase JWT attached. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 || res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.detail || (res.status === 401 ? "Please log in again." : "Please slow down a little."));
  }
  return res;
}

export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
