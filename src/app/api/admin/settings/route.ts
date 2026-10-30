import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => container().adminApi.getSettings(req);
export const PATCH = (req: Request) => container().adminApi.updateSettings(req);
