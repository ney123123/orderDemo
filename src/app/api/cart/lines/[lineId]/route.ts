import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ lineId: string }> };

export const PATCH = async (req: Request, { params }: Ctx) => container().customerApi.updateLine(req, (await params).lineId);
export const DELETE = async (req: Request, { params }: Ctx) => container().customerApi.removeLine(req, (await params).lineId);
