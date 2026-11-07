import { getEvaluation, listDialogues } from "@/server/db";
import { handle, ok } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Final results (after appeals) for a group, as JSON or CSV. */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const group = sp.get("group");
  const rows = listDialogues({ group })
    .filter((d) => d.evaluation?.status === "done")
    .map((d) => getEvaluation(d.evaluation!.id)!);
  if (sp.get("format") !== "csv") {
    return ok({
      results: rows.map((e) => ({
        conversation_id: e.dialogueId,
        total: e.finalScore.total,
        gross_error: e.finalScore.grossError,
        model: e.model,
        criteria: e.finalJudgments.map((j) => ({
          id: j.criterionId,
          answer: j.answer,
          explanation: j.explanation,
          evidence: j.evidenceTurnIds,
          confidence: j.confidence,
        })),
      })),
    });
  }
  const crit = rows[0]?.checklist.criteria.map((c) => c.id) ?? [];
  const lines = [["conversation_id", ...crit, "total", "gross_error", "model"].join(",")];
  for (const e of rows) {
    const m = new Map(e.finalJudgments.map((j) => [j.criterionId, j.answer]));
    lines.push([e.dialogueId, ...crit.map((c) => String(m.get(c) ?? "")), e.finalScore.total ?? "", e.finalScore.grossError ? 1 : 0, e.model].join(","));
  }
  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="cqa-${group ?? "all"}.csv"` },
  });
});
