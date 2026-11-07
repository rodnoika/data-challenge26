import { getEvaluation, listAppeals, reviewAppeal } from "@/server/db";
import { parseAnswer } from "@/core/scoring";
import { fail, handle, ok, type Ctx } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const { decision, newAnswer, reason } = await req.json();
  if (decision !== "upheld" && decision !== "changed") return fail("decision must be upheld or changed");
  if (!reason || !String(reason).trim()) return fail("Причина обязательна");
  const appeal = listAppeals({}).find((a) => a.id === id);
  if (!appeal) return fail("Appeal not found", 404);
  if (appeal.status !== "open") return fail("Апелляция уже рассмотрена");
  let parsed = null;
  if (decision === "changed") {
    const ev = getEvaluation(appeal.evaluationId);
    const c = ev?.checklist.criteria.find((x) => x.id === appeal.criterionId);
    parsed = c ? parseAnswer(c, newAnswer) : null;
    if (parsed === null) return fail("Недопустимое значение оценки для этого критерия");
  }
  const updated = reviewAppeal(id, decision, parsed, String(reason).trim());
  return ok({ appeal: updated, evaluation: getEvaluation(updated.evaluationId) });
});
