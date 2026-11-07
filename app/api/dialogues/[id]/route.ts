import { computeFacts } from "@/core/facts";
import { getActiveChecklist, getDialogue, getEvaluation, listEvaluationsForDialogue } from "@/server/db";
import { fail, handle, ok, type Ctx } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const d = getDialogue(decodeURIComponent(id));
  if (!d) return fail("Dialogue not found", 404);
  const history = listEvaluationsForDialogue(d.conversation_id) as any[];
  const evalId = new URL(req.url).searchParams.get("evaluation") ?? history.find((h) => h.status === "done")?.id;
  const evaluation = evalId ? getEvaluation(evalId) : null;
  const cl = evaluation?.checklist ?? getActiveChecklist();
  return ok({ dialogue: d, facts: evaluation?.facts ?? computeFacts(d, cl.waitThresholdSec), evaluation, history });
});
