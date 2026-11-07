import { resultsCsv } from "@/core/export";
import { checklistFormatProblems, SCHEMA_VERSION, submissionModel, toResult, validateSubmission, type Submission } from "@/core/submission";
import { DEFAULT_CHECKLIST } from "@/core/defaultChecklist";
import { getEvaluation, getSettings, listDialogues } from "@/server/db";
import { fail, handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Final results (after appeals) for a group: results.json in the organisers' format 1.0, or CSV. */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const group = sp.get("group");
  const rows = listDialogues({ group })
    .filter((d) => d.evaluation?.status === "done")
    .map((d) => getEvaluation(d.evaluation!.id)!);
  if (sp.get("format") !== "csv") {
    const team = process.env.CQA_TEAM_NAME?.trim();
    if (!team) return fail("Не задано название команды: добавьте CQA_TEAM_NAME в .env и перезапустите сервер.", 422);
    const mismatch = [...new Map(rows.map((e) => [`${e.checklistId} v${e.checklistVersion}`, e])).values()].flatMap((e) =>
      checklistFormatProblems(e.checklist).map((p) => `«${e.checklist.name}» v${e.checklistVersion}: ${p}`),
    );
    if (mismatch.length) return fail(`Формат организаторов рассчитан на 8 исходных критериев. Переоцените набор исходным чек-листом или выгрузите CSV.\n${mismatch.join("\n")}`, 409);
    const dialogues = listDialogues({ group });
    const byDialogue = new Map(rows.map((e) => [e.dialogueId, e]));
    const voters = rows.flatMap((e) =>
      e.provider === "ensemble"
        ? e.model.split("+").map((v) => ({ provider: v.split("/")[0], model: v.split("/").slice(1).join("/") }))
        : [{ provider: e.provider, model: e.model }],
    );
    const submission: Submission = {
      schema_version: SCHEMA_VERSION,
      team_name: team,
      model: submissionModel(voters.length ? voters : [{ provider: getSettings().provider, model: getSettings().model }]),
      results: dialogues.map((d) => {
        const e = byDialogue.get(d.id);
        if (e) return toResult(d.id, e.checklist, e.finalJudgments);
        // The format asks for one record per dialogue and forbids hiding failures.
        return toResult(d.id, DEFAULT_CHECKLIST, [], d.evaluation ? "Не удалось получить ответ модели." : "Диалог не оценён.");
      }),
    };
    const problems = validateSubmission(submission, { source: new Map(dialogues.map((d) => [d.id, d.turns])) });
    if (problems.length) return fail(`Файл не прошёл проверку формата:\n${problems.slice(0, 20).join("\n")}`, 422);
    return new Response(JSON.stringify(submission, null, 2) + "\n", {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="results.json"' },
    });
  }
  const csv = resultsCsv(
    rows.map((e) => ({
      dialogueId: e.dialogueId,
      checklistId: e.checklistId,
      checklistVersion: e.checklistVersion,
      answers: e.finalJudgments,
      total: e.finalScore.total,
      gross: e.finalScore.grossError,
      model: e.model,
    })),
  );
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="cqa-${group ?? "all"}.csv"` },
  });
});
