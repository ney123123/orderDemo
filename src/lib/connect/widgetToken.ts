import { createHmac } from "node:crypto";

/**
 * JWT for the Connect Communications Widget's `authenticate` callback (pass-contact-attributes-chat):
 * HS256, signed with the widget's security key, sub = widget id, attributes = string map that becomes
 * contact attributes. Attributes are encoded, not encrypted, so only an opaque cartRef goes in.
 */
export function signWidgetToken(opts: { widgetId: string; securityKey: string; attributes: Record<string, string>; now: Date; ttlSeconds?: number }): string {
  const iat = Math.floor(opts.now.getTime() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: opts.widgetId, iat, exp: iat + (opts.ttlSeconds ?? 300), attributes: opts.attributes })}`;
  return `${body}.${createHmac("sha256", opts.securityKey).update(body).digest("base64url")}`;
}
