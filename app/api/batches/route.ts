import { latestBatch } from "@/server/db";
import { startBatch } from "@/server/service";
import { fail, handle, ok } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request) => {
  const { groupId, onlyMissing, ids } = await req.json();
  if (!groupId) return fail("groupId is required");
  return ok({ jobId: startBatch(groupId, { onlyMissing: !!onlyMissing, ids }) });
});

export const GET = handle(async (req: Request) => {
  const group = new URL(req.url).searchParams.get("group");
  return ok({ job: group ? latestBatch(group) : null });
});
