import { runEvaluation } from "@/server/service";
import { fail, handle, ok } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = handle(async (req: Request) => {
  const { dialogueId, checklistId } = await req.json();
  if (!dialogueId) return fail("dialogueId is required");
  try {
    return ok({ evaluation: await runEvaluation(dialogueId, checklistId) });
  } catch (e) {
    return fail(e, 502);
  }
});
