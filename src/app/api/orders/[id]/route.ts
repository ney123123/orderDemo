import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";

export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  container().customerApi.getOrder(req, (await params).id);
