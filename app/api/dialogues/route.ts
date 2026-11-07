import { listDialogues, upsertDialogues } from "@/server/db";
import { normaliseRecords } from "@/server/service";
import { handle, ok } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const group = new URL(req.url).searchParams.get("group");
  return ok({ dialogues: listDialogues({ group }) });
});

/** Upload: a single record, an array of records, or the organisers' full payload. */
export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const groupId: string = body?.groupId || "UPLOAD";
  const list = normaliseRecords(body?.payload ?? body);
  upsertDialogues(list, groupId, "upload");
  return ok({ groupId, count: list.length, ids: list.map((d) => d.conversation_id) });
});
