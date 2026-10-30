import type { z } from "zod";
import type { DomainError } from "../domain/errors";

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name && !(name in out)) {
      try {
        out[name] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        // ignore malformed cookie values
      }
    }
  }
  return out;
}

export interface CookieOptions {
  maxAge?: number;
  sameSite?: "Strict" | "Lax";
  secure: boolean;
  path?: string;
}

export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? "/"}`, "HttpOnly", `SameSite=${o.sameSite ?? "Lax"}`];
  if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`);
  if (o.secure) parts.push("Secure");
  return parts.join("; ");
}

export function json(status: number, body: unknown, cookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(error: DomainError, cookies: string[] = []): Response {
  return json(statusFor(error.code), { ok: false, error }, cookies);
}

function statusFor(code: DomainError["code"]): number {
  if (code === "INVALID_INPUT") return 400;
  if (code === "NOT_FOUND") return 404;
  if (code === "CONFLICT" || code === "ALREADY_SUBMITTED") return 409;
  return 422;
}

/** Parses and validates a JSON body. Never echoes the input back. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<{ ok: true; value: z.infer<S> } | { ok: false; response: Response }> {
  const text = await req.text();
  if (text.length > 16_384) return { ok: false, response: json(413, { ok: false, error: { code: "INVALID_INPUT", message: "Request too large." } }) };
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, response: json(400, { ok: false, error: { code: "INVALID_INPUT", message: "Body must be JSON." } }) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return { ok: false, response: json(400, { ok: false, error: { code: "INVALID_INPUT", message } }) };
  }
  return { ok: true, value: parsed.data };
}

/**
 * CSRF guard for state-changing requests: browsers always send Origin on cross-site POST/PATCH/DELETE,
 * so require it to match the request's own host (or the configured public origin).
 */
export function sameOrigin(req: Request, allowedOrigins: string[] = []): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    const o = new URL(origin);
    return o.host === host || allowedOrigins.includes(o.origin);
  } catch {
    return false;
  }
}

export const forbidden = () => json(403, { ok: false, error: { code: "FORBIDDEN", message: "Cross-site request refused." } });
