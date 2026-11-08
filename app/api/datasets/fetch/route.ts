import { fetchDataset, fetchDatasetFromUrl } from "@/server/service";
import { fail, handle, ok } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Load a set by group_id from the configured organisers' API, or from a pasted https link. */
export const POST = handle(async (req: Request) => {
  const { groupId, url } = await req.json();
  if (typeof url === "string" && url.trim()) {
    try {
      return ok(await fetchDatasetFromUrl(url, typeof groupId === "string" ? groupId : undefined));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e), 400);
    }
  }
  if (!groupId || typeof groupId !== "string") return fail("groupId or url is required");
  return ok(await fetchDataset(groupId.trim()));
});
