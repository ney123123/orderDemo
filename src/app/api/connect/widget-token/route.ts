import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";

export const POST = (req: Request) => container().customerApi.widgetToken(req);
