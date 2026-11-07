import type {
  Answer,
  Checklist,
  Criterion,
  CriterionScore,
  Judgment,
  ScoreResult,
  SectionScore,
} from "./types";

/** Fraction of the weight earned for an answer (0..1), or null if N/A / invalid. */
export function answerFraction(c: Criterion, answer: Answer): number | null {
  if (answer === "na") return null;
  if (c.answerType === "yes_no") {
    if (answer === "yes") return 1;
    if (answer === "no") return 0;
    return null;
  }
  const steps = (c.steps ?? []).map((s) => s.value);
  if (!steps.length || typeof answer !== "number") return null;
  const max = Math.max(...steps);
  const min = Math.min(...steps);
  if (max === min) return answer >= max ? 1 : 0;
  // Proportional: the top step gives the full weight. Scales start at 0 in the PDF;
  // a non-zero minimum is treated as 0 points, matching "proportional to the weight".
  return Math.max(0, Math.min(1, answer / max));
}

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * Deterministic scoring, following the checklist's calculation order:
 * 1) applicability (N/A only where allowed), 2) answer, 3) scale -> points proportional
 * to weight, 4) drop N/A and redistribute weight so the maximum stays 100,
 * 5) round the total to 2 decimals; no total if no weighted criterion applies;
 * gross errors flagged separately.
 */
export function score(checklist: Checklist, judgments: Judgment[]): ScoreResult {
  const byId = new Map(judgments.map((j) => [j.criterionId, j]));
  const weighted = checklist.criteria.filter((c) => !c.isFlag && c.weight > 0);

  const rows: CriterionScore[] = [];
  let applicableWeight = 0;
  for (const c of weighted) {
    const j = byId.get(c.id);
    let answer: Answer = j ? j.answer : "na";
    if (answer === "na" && !c.naAllowed) answer = c.answerType === "yes_no" ? "no" : 0;
    const frac = answerFraction(c, answer);
    const applicable = frac !== null;
    if (applicable) applicableWeight += c.weight;
    rows.push({
      criterionId: c.id,
      answer,
      weight: c.weight,
      applicable,
      rawPoints: applicable ? c.weight * (frac as number) : 0,
      points: 0,
      maxPoints: 0,
    });
  }

  const factor = applicableWeight > 0 ? 100 / applicableWeight : 0;
  for (const r of rows) {
    if (!r.applicable) continue;
    r.points = r.rawPoints * factor;
    r.maxPoints = r.weight * factor;
  }

  // Flags (no points)
  const grossCriteria: string[] = [];
  for (const c of checklist.criteria.filter((c) => c.isFlag || c.weight <= 0)) {
    const j = byId.get(c.id);
    const answer: Answer = j ? j.answer : "na";
    if (c.isFlag && answer === "yes") grossCriteria.push(c.id);
    rows.push({
      criterionId: c.id,
      answer,
      weight: 0,
      applicable: false,
      rawPoints: 0,
      points: 0,
      maxPoints: 0,
    });
  }

  const sections: SectionScore[] = checklist.sections.map((s) => {
    const ids = new Set(checklist.criteria.filter((c) => c.sectionId === s.id).map((c) => c.id));
    const inS = rows.filter((r) => ids.has(r.criterionId));
    return {
      sectionId: s.id,
      title: s.title,
      points: round2(inS.reduce((a, r) => a + r.points, 0)),
      maxPoints: round2(inS.reduce((a, r) => a + r.maxPoints, 0)),
      hasApplicable: inS.some((r) => r.applicable),
    };
  });

  const total =
    applicableWeight > 0 ? round2(rows.reduce((a, r) => a + r.points, 0)) : null;

  // keep original checklist order
  const order = new Map(checklist.criteria.map((c, i) => [c.id, i]));
  rows.sort((a, b) => (order.get(a.criterionId)! - order.get(b.criterionId)!));

  return { total, criteria: rows, sections, grossError: grossCriteria.length > 0, grossCriteria };
}

/** Allowed answers for a criterion, as strings (used by the prompt schema and the UI). */
export function allowedAnswers(c: Criterion): string[] {
  const base =
    c.answerType === "yes_no"
      ? ["yes", "no"]
      : [...(c.steps ?? [])].sort((a, b) => a.value - b.value).map((s) => String(s.value));
  return c.naAllowed ? [...base, "na"] : base;
}

export function parseAnswer(c: Criterion, raw: string | number): Answer | null {
  const s = String(raw).trim().toLowerCase();
  if (s === "na" || s === "n/a") return c.naAllowed ? "na" : null;
  if (c.answerType === "yes_no") {
    if (s === "yes" || s === "да" || s === "true") return "yes";
    if (s === "no" || s === "нет" || s === "false") return "no";
    return null;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const steps = (c.steps ?? []).map((x) => x.value);
  return steps.includes(n) ? n : null;
}

export function formatAnswer(c: Criterion | undefined, a: Answer): string {
  if (a === "na") return "N/A";
  if (a === "yes") return "Да";
  if (a === "no") return "Нет";
  if (c?.answerType === "scale") {
    const max = Math.max(...(c.steps ?? []).map((s) => s.value));
    return `${a} / ${max}`;
  }
  return String(a);
}

/** Validate a checklist before saving. Returns a list of human-readable problems. */
export function validateChecklist(cl: Checklist): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const sectionIds = new Set(cl.sections.map((s) => s.id));
  if (!cl.criteria.length) errs.push("Чек-лист пуст.");
  for (const c of cl.criteria) {
    const label = `${c.code || c.id} «${c.title || "без названия"}»`;
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(c.id)) errs.push(`${label}: некорректный id.`);
    if (ids.has(c.id)) errs.push(`${label}: повторяющийся id.`);
    ids.add(c.id);
    if (!c.title.trim()) errs.push(`${label}: нет названия.`);
    if (!c.description.trim()) errs.push(`${label}: нет формулировки.`);
    if (!sectionIds.has(c.sectionId)) errs.push(`${label}: неизвестная секция.`);
    if (c.weight < 0) errs.push(`${label}: отрицательный вес.`);
    if (c.answerType === "scale") {
      const vals = (c.steps ?? []).map((s) => s.value);
      if (vals.length < 2) errs.push(`${label}: у шкалы должно быть минимум 2 ступени.`);
      if (new Set(vals).size !== vals.length) errs.push(`${label}: ступени шкалы повторяются.`);
      if (vals.some((v) => !Number.isFinite(v) || v < 0)) errs.push(`${label}: ступени должны быть числами ≥ 0.`);
      if (vals.length && Math.max(...vals) <= 0) errs.push(`${label}: верхняя ступень должна быть > 0.`);
    }
    if (c.naAllowed && !c.naCondition?.trim()) errs.push(`${label}: не указано условие N/A.`);
  }
  return errs;
}
