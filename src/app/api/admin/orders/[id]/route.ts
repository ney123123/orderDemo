import { container } from "@/lib/server/container";

export const dynamic = "force-dynamic";

export const PATCH = async (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  container().adminApi.updateOrderStatus(req, (await params).id);
