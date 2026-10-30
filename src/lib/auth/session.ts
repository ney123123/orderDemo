import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const ADMIN_COOKIE = "admin_session";
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

const ClaimsSchema = z.object({ sub: z.string(), role: z.literal("admin"), exp: z.number() });
export type AdminClaims = z.infer<typeof ClaimsSchema>;

/** Stateless signed session: base64url(claims).base64url(HMAC-SHA256). */
export function signSession(claims: AdminClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function verifySession(token: string | undefined, secret: string, now: Date = new Date()): AdminClaims | undefined {
  if (!token) return undefined;
  const [body, sig] = token.split(".");
  if (!body || !sig) return undefined;
  const expected = Buffer.from(mac(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  try {
    const claims = ClaimsSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    return claims.exp * 1000 > now.getTime() ? claims : undefined;
  } catch {
    return undefined;
  }
}

const mac = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");
