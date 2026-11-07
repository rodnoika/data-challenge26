import { fetchDataset } from "@/server/service";
import { fail, handle, ok } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = handle(async (req: Request) => {
  const { groupId } = await req.json();
  if (!groupId || typeof groupId !== "string") return fail("groupId is required");
  return ok(await fetchDataset(groupId.trim()));
});
