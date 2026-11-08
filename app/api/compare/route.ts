import { compareRuns } from "@/core/compare";
import type { Checklist } from "@/core/types";
import { evaluatedVersions, getChecklist, getEvaluation, latestEvaluationIds, listDialogues, listChecklists } from "@/server/db";
import { fail, handle, ok } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseRef = (s: string | null) => {
  const m = s ? /^(.+)@(\d+)$/.exec(s) : null;
  return m ? { id: m[1], version: Number(m[2]) } : null;
};

/**
 * Before/after view of a checklist change: the dialogues of a group evaluated with version A and with version B.
 * Defaults: B = the most recently used version, A = the one used before it. Model output before appeals.
 */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const group = sp.get("group");
  if (!group) return fail("group is required");
  const names = new Map(listChecklists().map((c) => [c.id, { name: c.name, active: c.isActive }]));
  const versions = evaluatedVersions(group).map((v) => ({ ...v, name: names.get(v.id)?.name ?? v.id }));
  const b = parseRef(sp.get("b")) ?? versions[0] ?? null;
  const a = parseRef(sp.get("a")) ?? versions.find((v) => !(b && v.id === b.id && v.version === b.version)) ?? null;
  if (!a || !b) return ok({ group, versions, a, b, result: null });
  const clA = getChecklist(a.id, a.version);
  const clB = getChecklist(b.id, b.version);
  if (!clA || !clB) return fail(`Checklist version not found: ${!clA ? `${a.id}@${a.version}` : `${b.id}@${b.version}`}`, 404);

  const idsA = latestEvaluationIds(group, a.id, a.version);
  const idsB = latestEvaluationIds(group, b.id, b.version);
  const sideOf = (id: string | undefined) => {
    const e = id ? getEvaluation(id) : null;
    return e ? { evaluationId: e.id, judgments: e.judgments, total: e.score.total, gross: e.score.grossError } : null;
  };
  const input = listDialogues({ group })
    .filter((d) => idsA.has(d.id) || idsB.has(d.id))
    .map((d) => ({ dialogueId: d.id, language: d.language, channel: d.channel, before: sideOf(idsA.get(d.id)), after: sideOf(idsB.get(d.id)) }));
  const result = compareRuns(clA, clB, input);
  const pick = (cl: Checklist) => Object.fromEntries(cl.criteria.map((c) => [c.id, c]));
  return ok({
    group,
    versions,
    a: { id: a.id, version: a.version, name: clA.name },
    b: { id: b.id, version: b.version, name: clB.name },
    criteria: { ...pick(clA), ...pick(clB) },
    result,
  });
});
