import { hashPassword } from "../../src/lib/auth/password";
import { MemoryRepository } from "../../src/lib/repositories/memory/memoryRepository";
import { loadConfig } from "../../src/lib/server/config";
import { buildContainer } from "../../src/lib/server/container";
import { OPEN_NOW } from "../helpers";

export const BASE = "http://localhost:3000";
export const ADMIN = { username: "owner", password: "correct horse battery" };

/** A browser: keeps cookies between requests and sends a same-origin Origin header. */
export class Browser {
  jar = new Map<string, string>();
  constructor(private origin = BASE) {}

  req(path: string, init: { method?: string; body?: unknown; origin?: string | null } = {}): Request {
    const headers = new Headers({ host: "localhost:3000" });
    const cookie = [...this.jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
    if (cookie) headers.set("cookie", cookie);
    const origin = init.origin === undefined ? this.origin : init.origin;
    if (origin && init.method && init.method !== "GET") headers.set("origin", origin);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    return new Request(BASE + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  }

  async send(res: Response | Promise<Response>) {
    const r = await res;
    for (const c of r.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [name, value] = pair!.split("=");
      if (attrs.some((a) => a.trim() === "Max-Age=0")) this.jar.delete(name!);
      else this.jar.set(name!, decodeURIComponent(value ?? ""));
    }
    return { status: r.status, body: (await r.json()) as any, headers: r.headers };
  }
}

export async function app(opts: { now?: Date } = {}) {
  const config = loadConfig({
    NODE_ENV: "test",
    ADMIN_USERNAME: ADMIN.username,
    ADMIN_PASSWORD_HASH: await hashPassword(ADMIN.password),
    SESSION_SECRET: "test-secret-test-secret-test-secret-123",
  });
  let clock = opts.now ?? OPEN_NOW;
  const tick = () => (clock = new Date(clock.getTime() + 1000));
  const c = buildContainer(config, { repo: new MemoryRepository(), now: () => tick() });
  return c;
}
