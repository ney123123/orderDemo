"use client";

export interface ApiError {
  code: string;
  message: string;
}

/** fetch wrapper for our JSON API. Errors come back as values, never thrown. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  try {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    const json = await res.json();
    return json.ok ? { ok: true, data: json as T } : { ok: false, error: json.error ?? { code: "ERROR", message: "Something went wrong." } };
  } catch {
    return { ok: false, error: { code: "NETWORK", message: "Couldn't reach the restaurant. Check your connection and try again." } };
  }
}

/** Tells every cart panel on the page to refresh now (instead of waiting for the next poll). */
export const announceCartChange = () => window.dispatchEvent(new Event("cart:changed"));
