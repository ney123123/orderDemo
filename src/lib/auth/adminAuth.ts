import { verifyPassword } from "./password";
import { ADMIN_SESSION_SECONDS, signSession, verifySession, type AdminClaims } from "./session";

export interface AdminAuthConfig {
  username: string;
  passwordHash: string;
  sessionSecret: string;
}

/**
 * Single admin account from configuration (Phase 2). Customers never get an admin session:
 * the only way to one is this login. Secrets move to Secrets Manager in Phase 6.
 */
export class AdminAuth {
  private failures = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly config: AdminAuthConfig | undefined,
    private readonly now: () => Date = () => new Date(),
    /** Off only under `next dev` (repeated typos locked the demo); on in tests and production. */
    private readonly lockout = true,
  ) {}

  get configured(): boolean {
    return this.config !== undefined;
  }

  /** Returns a session token, or undefined. With lockout on, locks a client out for 5 minutes after 5 failures. */
  async login(username: string, password: string, clientKey: string): Promise<string | undefined> {
    if (!this.config) return undefined;
    const t = this.now().getTime();
    const f = this.failures.get(clientKey);
    if (this.lockout && f && f.count >= 5 && f.until > t) return undefined;

    const okUser = username === this.config.username;
    // Always run the hash so a wrong username takes as long as a wrong password.
    const okPassword = await verifyPassword(password, this.config.passwordHash);
    if (!okUser || !okPassword) {
      const count = f && f.until > t ? f.count + 1 : 1;
      this.failures.set(clientKey, { count, until: t + 5 * 60_000 });
      return undefined;
    }
    this.failures.delete(clientKey);
    return signSession({ sub: username, role: "admin", exp: Math.floor(t / 1000) + ADMIN_SESSION_SECONDS }, this.config.sessionSecret);
  }

  verify(token: string | undefined): AdminClaims | undefined {
    return this.config ? verifySession(token, this.config.sessionSecret, this.now()) : undefined;
  }
}
