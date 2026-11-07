import { createAppeal, getDialogue, getEvaluation, listAppeals } from "@/server/db";
import { fail, handle, ok } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reviewer queue: each appeal with its evaluation, criterion and the transcript for the fragment view. */
export const GET = handle(async (req: Request) => {
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  const appeals = listAppeals({ status: status === "all" ? undefined : status });
  const items = appeals.map((a) => {
    const ev = getEvaluation(a.evaluationId);
    const d = getDialogue(a.dialogueId);
    return {
      appeal: a,
      criterion: ev?.checklist.criteria.find((c) => c.id === a.criterionId) ?? null,
      judgment: ev?.judgments.find((j) => j.criterionId === a.criterionId) ?? null,
      originalTotal: ev?.score.total ?? null,
      finalTotal: ev?.finalScore.total ?? null,
      dialogue: d ? { id: d.conversation_id, language: d.language, channel: d.channel, transcript: d.transcript } : null,
    };
  });
  return ok({ items });
});

export const POST = handle(async (req: Request) => {
  const { evaluationId, criterionId, comment } = await req.json();
  if (!evaluationId || !criterionId) return fail("evaluationId and criterionId are required");
  if (!comment || !String(comment).trim()) return fail("Комментарий обязателен");
  return ok({ appeal: createAppeal(evaluationId, criterionId, String(comment).trim()) });
});
