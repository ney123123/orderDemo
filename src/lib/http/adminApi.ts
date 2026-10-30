import { z } from "zod";
import { AdminService, MenuItemPatchSchema, OrderStatusChangeSchema, SettingsPatchSchema } from "../domain/admin/service";
import { OrderStatusSchema } from "../domain/order/schema";
import type { AdminAuth } from "../auth/adminAuth";
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS } from "../auth/session";
import type { Repository } from "../repositories/repository";
import { errorResponse, forbidden, json, parseCookies, readJson, sameOrigin, serializeCookie } from "./http";

const LoginBody = z.object({ username: z.string().max(100), password: z.string().max(200) }).strict();
const MenuItemBody = z.object({ patch: MenuItemPatchSchema, expectedUpdatedAt: z.string() }).strict();
const SettingsBody = z.object({ patch: SettingsPatchSchema, expectedUpdatedAt: z.string() }).strict();

export interface AdminApiDeps {
  admin: AdminService;
  auth: AdminAuth;
  repo: Repository;
  secureCookies: boolean;
  allowedOrigins?: string[];
}

const unauthorized = () => json(401, { ok: false, error: { code: "UNAUTHORIZED", message: "Admin login required." } });

/** /api/admin/*: every handler except login checks the signed admin session first (§11 Phase 2). */
export function createAdminApi(deps: AdminApiDeps) {
  const isAdmin = (req: Request) => deps.auth.verify(parseCookies(req)[ADMIN_COOKIE]) !== undefined;

  const guarded =
    <A extends unknown[]>(fn: (req: Request, ...args: A) => Promise<Response>, opts: { mutation: boolean }) =>
    async (req: Request, ...args: A) => {
      if (opts.mutation && !sameOrigin(req, deps.allowedOrigins)) return forbidden();
      if (!isAdmin(req)) return unauthorized();
      return fn(req, ...args);
    };
  const read = <A extends unknown[]>(fn: (req: Request, ...args: A) => Promise<Response>) => guarded(fn, { mutation: false });
  const write = <A extends unknown[]>(fn: (req: Request, ...args: A) => Promise<Response>) => guarded(fn, { mutation: true });

  const sessionCookie = (value: string, maxAge: number) =>
    serializeCookie(ADMIN_COOKIE, value, { secure: deps.secureCookies, sameSite: "Strict", maxAge });

  return {
    async login(req: Request): Promise<Response> {
      if (!sameOrigin(req, deps.allowedOrigins)) return forbidden();
      if (!deps.auth.configured) {
        return json(503, { ok: false, error: { code: "NOT_CONFIGURED", message: "Admin login is not configured (ADMIN_USERNAME, ADMIN_PASSWORD_HASH, SESSION_SECRET)." } });
      }
      const body = await readJson(req, LoginBody);
      if (!body.ok) return body.response;
      const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
      const token = await deps.auth.login(body.value.username, body.value.password, client);
      if (!token) return json(401, { ok: false, error: { code: "UNAUTHORIZED", message: "Wrong username or password, or too many attempts." } });
      return json(200, { ok: true }, [sessionCookie(token, ADMIN_SESSION_SECONDS)]);
    },

    async logout(req: Request): Promise<Response> {
      if (!sameOrigin(req, deps.allowedOrigins)) return forbidden();
      return json(200, { ok: true }, [sessionCookie("", 0)]);
    },

    overview: read(async () => json(200, { ok: true, ...(await deps.admin.overview()) })),

    listOrders: read(async (req) => {
      const url = new URL(req.url);
      const status = OrderStatusSchema.safeParse(url.searchParams.get("status") ?? undefined);
      const since = url.searchParams.get("since");
      const orders = await deps.repo.listOrders({
        status: status.success ? status.data : undefined,
        since: since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : undefined,
      });
      return json(200, { ok: true, orders });
    }),

    updateOrderStatus: write(async (req, orderId: string) => {
      const body = await readJson(req, OrderStatusChangeSchema);
      if (!body.ok) return body.response;
      const r = await deps.admin.setOrderStatus(orderId, body.value);
      return r.ok ? json(200, { ok: true, order: r.value }) : errorResponse(r.error);
    }),

    getMenu: read(async () => json(200, { ok: true, menu: await deps.repo.getMenu() })),

    updateMenuItem: write(async (req, itemId: string) => {
      const body = await readJson(req, MenuItemBody);
      if (!body.ok) return body.response;
      const r = await deps.admin.updateMenuItem(itemId, body.value.patch, body.value.expectedUpdatedAt);
      return r.ok ? json(200, { ok: true, menu: r.value.menu }) : errorResponse(r.error);
    }),

    getSettings: read(async () => json(200, { ok: true, settings: await deps.repo.getSettings() })),

    updateSettings: write(async (req) => {
      const body = await readJson(req, SettingsBody);
      if (!body.ok) return body.response;
      const r = await deps.admin.updateSettings(body.value.patch, body.value.expectedUpdatedAt);
      return r.ok ? json(200, { ok: true, settings: r.value }) : errorResponse(r.error);
    }),
  };
}
export type AdminApi = ReturnType<typeof createAdminApi>;
