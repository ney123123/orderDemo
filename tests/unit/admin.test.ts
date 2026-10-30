import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/auth/password";
import { signSession, verifySession } from "../../src/lib/auth/session";
import { startOfLocalDay } from "../../src/lib/domain/settings/hours";

describe("admin auth primitives", () => {
  it("verifies scrypt passwords", async () => {
    const h = await hashPassword("a long enough password");
    expect(h).toMatch(/^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/);
    expect(await verifyPassword("a long enough password", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });

  it("signs sessions and rejects tampering, other secrets and expiry", () => {
    const secret = "s".repeat(32);
    const now = new Date("2026-10-29T16:00:00Z");
    const token = signSession({ sub: "owner", role: "admin", exp: now.getTime() / 1000 + 60 }, secret);
    expect(verifySession(token, secret, now)).toMatchObject({ sub: "owner" });
    expect(verifySession(token, "t".repeat(32), now)).toBeUndefined();
    expect(verifySession(token.replace(/^./, "x"), secret, now)).toBeUndefined();
    expect(verifySession(token, secret, new Date(now.getTime() + 61_000))).toBeUndefined();
    expect(verifySession(undefined, secret, now)).toBeUndefined();
  });
});

describe("startOfLocalDay", () => {
  it("is local midnight in the restaurant time zone", () => {
    expect(startOfLocalDay(new Date("2026-10-29T16:00:00Z"), "America/Toronto")).toBe("2026-10-29T04:00:00.000Z");
    expect(startOfLocalDay(new Date("2026-10-29T03:00:00Z"), "America/Toronto")).toBe("2026-10-28T04:00:00.000Z");
    expect(startOfLocalDay(new Date("2026-12-01T12:00:00Z"), "America/Toronto")).toBe("2026-12-01T05:00:00.000Z");
  });
});
