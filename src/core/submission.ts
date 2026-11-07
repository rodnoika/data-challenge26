import { DEFAULT_CHECKLIST } from "./defaultChecklist";
import { round2, score } from "./scoring";
import type { Answer, Checklist, Judgment } from "./types";

/**
 * Results file for the organisers (CQA_Student_Guide_Appendix_Results.pdf, format 1.0).
 * Internally turns count from 0; the file counts from 1, over the whole transcript.
 */
export const SCHEMA_VERSION = "1.0";

type ValueKind = { codes: "boolean" | number[]; nullable: boolean; weight: number };

/** Field names, codes, value types and weights are fixed by the format. */
export const SUBMISSION_CRITERIA: Record<string, { code: string } & ValueKind> = {
  c01: { code: "contact", codes: "boolean", nullable: false, weight: 10 },
  c02: { code: "discovery", codes: "boolean", nullable: true, weight: 15 },
  c03: { code: "identification", codes: "boolean", nullable: true, weight: 20 },
  c04: { code: "consultation", codes: [0, 5, 10, 15, 20], nullable: true, weight: 20 },
  c05: { code: "empathy", codes: "boolean", nullable: false, weight: 15 },
  c06: { code: "dialogue", codes: [0, 4, 7, 10], nullable: false, weight: 15 },
  c07: { code: "closure", codes: "boolean", nullable: true, weight: 5 },
  c08: { code: "critical", codes: "boolean", nullable: false, weight: 0 },
};

export type SubmissionValue = boolean | number | null;

export interface SubmissionCriterion {
  criterion_id: string;
  value: SubmissionValue;
  rationale: string;
  evidence_turns: number[];
}

export interface SubmissionResult {
  conversation_id: string;
  status: "ok" | "error";
  criteria: SubmissionCriterion[];
  score: { final_score: number; critical_flag: boolean } | null;
  error?: string;
}

export interface Submission {
  schema_version: string;
  team_name: string;
  model: { mode: "local" | "external_api" | "hybrid"; name: string };
  results: SubmissionResult[];
}

const toValue = (a: Answer): SubmissionValue => (a === "yes" ? true : a === "no" ? false : a === "na" ? null : a);

/** Explanations cite turns as [9], [12–14] or [4, 9] counted from 0; the file counts from 1. */
export function shiftTurnRefs(text: string): string {
  return text.replace(/\[[\d\s,–—-]+\]/g, (m) => m.replace(/\d+/g, (n) => String(Number(n) + 1)));
}

/**
 * The format fixes the 8 criteria, their scales and weights. A checklist that changed any of them, even
 * under the same id, cannot be written truthfully under those codes.
 */
export function checklistFormatProblems(cl: Checklist): string[] {
  const out: string[] = [];
  const base = new Map(DEFAULT_CHECKLIST.criteria.map((c) => [c.id, c]));
  for (const c of cl.criteria) {
    const spec = SUBMISSION_CRITERIA[c.id];
    const def = base.get(c.id);
    if (!spec || !def) {
      out.push(`${c.code} «${c.title}» (${c.id}): такого критерия нет в формате`);
      continue;
    }
    const steps = (x: typeof c) => JSON.stringify((x.steps ?? []).map((st) => st.value).sort((a, b) => a - b));
    if (c.title.trim() !== def.title.trim() || c.answerType !== def.answerType || steps(c) !== steps(def) || c.weight !== def.weight) {
      out.push(`${c.code} «${c.title}»: отличается от критерия «${def.title}» из формата`);
    }
  }
  for (const id of Object.keys(SUBMISSION_CRITERIA)) if (!cl.criteria.some((c) => c.id === id)) out.push(`нет критерия ${SUBMISSION_CRITERIA[id].code}`);
  return out;
}

/** Model entry of the file from the provider of every vote. */
export function submissionModel(voters: { provider: string; model: string }[]): Submission["model"] {
  const local = voters.filter((v) => v.provider === "ollama").length;
  return {
    mode: local === 0 ? "external_api" : local === voters.length ? "local" : "hybrid",
    name: [...new Set(voters.map((v) => v.model))].join(", "),
  };
}

export function toResult(conversationId: string, cl: Checklist, judgments: Judgment[], error?: string | null): SubmissionResult {
  if (error) return { conversation_id: conversationId, status: "error", criteria: [], score: null, error };
  const problems = checklistFormatProblems(cl);
  if (problems.length) throw new Error(problems.join("; "));
  const by = new Map(judgments.map((j) => [j.criterionId, j]));
  const s = score(cl, judgments);
  return {
    conversation_id: conversationId,
    status: "ok",
    criteria: Object.entries(SUBMISSION_CRITERIA).map(([id, { code }]) => {
      const j = by.get(id);
      if (!j) throw new Error(`${conversationId}: no answer for ${id}`);
      return {
        criterion_id: code,
        value: toValue(j.answer),
        rationale: shiftTurnRefs(j.explanation),
        evidence_turns: [...new Set(j.evidenceTurnIds)].sort((a, b) => a - b).map((t) => t + 1),
      };
    }),
    score: { final_score: s.total as number, critical_flag: s.grossError },
  };
}

/** Recomputes the score from the values alone, independently of the evaluator. */
export function expectedFinalScore(criteria: SubmissionCriterion[]): number | null {
  let earned = 0;
  let max = 0;
  for (const c of criteria) {
    const spec = Object.values(SUBMISSION_CRITERIA).find((s) => s.code === c.criterion_id);
    if (!spec || !spec.weight || c.value === null) continue;
    const share = spec.codes === "boolean" ? (c.value === true ? 1 : 0) : Number(c.value) / Math.max(...spec.codes);
    earned += spec.weight * share;
    max += spec.weight;
  }
  return max ? round2((earned * 100) / max) : null;
}

export interface ValidateOptions {
  /** Exact number of records the set must hold (10 for prod). */
  expectedCount?: number;
  /** Conversation id -> transcript length, to check ids and turn numbers against the source. */
  source?: Map<string, number>;
}

/** Every rule the format states. An empty list means the file is ready to push. */
export function validateSubmission(sub: Submission, opts: ValidateOptions = {}): string[] {
  const errs: string[] = [];
  if (sub.schema_version !== SCHEMA_VERSION) errs.push(`schema_version must be "${SCHEMA_VERSION}"`);
  if (!sub.team_name?.trim()) errs.push("team_name is empty");
  if (!["local", "external_api", "hybrid"].includes(sub.model?.mode)) errs.push("model.mode must be local, external_api or hybrid");
  if (!sub.model?.name?.trim()) errs.push("model.name is empty");
  if (!Array.isArray(sub.results)) return [...errs, "results must be an array"];
  if (opts.expectedCount !== undefined && sub.results.length !== opts.expectedCount) errs.push(`expected ${opts.expectedCount} records, found ${sub.results.length}`);

  const seen = new Set<string>();
  const codes = Object.values(SUBMISSION_CRITERIA).map((s) => s.code);
  for (const r of sub.results) {
    const id = r.conversation_id;
    if (seen.has(id)) errs.push(`${id}: duplicate conversation_id`);
    seen.add(id);
    const turns = opts.source?.get(id);
    if (opts.source && turns === undefined) errs.push(`${id}: not in the source data`);

    if (r.status === "error") {
      if (r.criteria?.length) errs.push(`${id}: status error needs empty criteria`);
      if (r.score !== null) errs.push(`${id}: status error needs score null`);
      if (!r.error?.trim()) errs.push(`${id}: status error needs a reason in error`);
      continue;
    }
    if (r.status !== "ok") {
      errs.push(`${id}: status must be ok or error`);
      continue;
    }
    const got = (r.criteria ?? []).map((c) => c.criterion_id);
    if (got.length !== codes.length || codes.some((c) => got.filter((x) => x === c).length !== 1)) errs.push(`${id}: needs each of the 8 criteria exactly once`);
    for (const c of r.criteria ?? []) {
      const spec = Object.values(SUBMISSION_CRITERIA).find((s) => s.code === c.criterion_id);
      if (!spec) continue;
      const okValue =
        c.value === null ? spec.nullable : spec.codes === "boolean" ? typeof c.value === "boolean" : typeof c.value === "number" && spec.codes.includes(c.value);
      if (!okValue) errs.push(`${id}: ${c.criterion_id} has invalid value ${JSON.stringify(c.value)}`);
      if (!c.rationale?.trim()) errs.push(`${id}: ${c.criterion_id} has no rationale`);
      if (!Array.isArray(c.evidence_turns) || c.evidence_turns.some((t) => !Number.isInteger(t) || t < 1 || (turns !== undefined && t > turns))) {
        errs.push(`${id}: ${c.criterion_id} has invalid evidence_turns ${JSON.stringify(c.evidence_turns)}`);
      }
    }
    if (!r.score) {
      errs.push(`${id}: status ok needs score`);
      continue;
    }
    const { final_score: total, critical_flag: flag } = r.score;
    if (typeof total !== "number" || total < 0 || total > 100 || round2(total) !== total) errs.push(`${id}: final_score ${total} is not 0..100 with two decimals`);
    const expected = expectedFinalScore(r.criteria ?? []);
    if (expected !== total) errs.push(`${id}: final_score ${total}, the values give ${expected}`);
    const critical = (r.criteria ?? []).find((c) => c.criterion_id === "critical")?.value;
    if (flag !== critical) errs.push(`${id}: critical_flag ${flag} differs from critical ${critical}`);
  }
  if (opts.source) for (const id of opts.source.keys()) if (!seen.has(id)) errs.push(`${id}: missing from results`);
  return errs;
}
