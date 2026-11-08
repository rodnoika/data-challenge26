// What a checklist change did to a dialogue set: the same dialogues evaluated with version A (before)
// and version B (after). Framework-free, shared by the API route and the page.
import type { Answer, Checklist, Criterion, Judgment } from "./types";

export type CriterionChange =
  | { kind: "same"; id: string }
  | { kind: "edited"; id: string; fields: string[] }
  | { kind: "replaced"; from: string; to: string }
  | { kind: "removed"; id: string }
  | { kind: "added"; id: string };

const FIELDS: (keyof Criterion)[] = ["title", "description", "answerType", "steps", "naAllowed", "naCondition", "weight", "isFlag", "guidance", "sectionId"];
const FIELD_RU: Record<string, string> = {
  title: "название",
  description: "формулировка",
  answerType: "тип ответа",
  steps: "шкала",
  naAllowed: "N/A",
  naCondition: "условие N/A",
  weight: "вес",
  isFlag: "флаг",
  guidance: "подсказка",
  sectionId: "секция",
};

/**
 * Criteria matched by id. A removed and an added criterion are paired as a replacement when they sit at the
 * same position in the list (the editor's "replace" is delete + add), otherwise in order of appearance.
 */
export function diffChecklists(a: Checklist, b: Checklist): CriterionChange[] {
  const inA = new Map(a.criteria.map((c) => [c.id, c]));
  const inB = new Map(b.criteria.map((c) => [c.id, c]));
  const removed = a.criteria.filter((c) => !inB.has(c.id));
  const added = b.criteria.filter((c) => !inA.has(c.id));
  const pairs = new Map<string, string>(); // added id -> removed id
  const free = [...removed];
  for (const c of added) {
    const pos = b.criteria.indexOf(c);
    const k = free.findIndex((r) => a.criteria.indexOf(r) === pos);
    const r = free.splice(k >= 0 ? k : 0, 1)[0];
    if (r) pairs.set(c.id, r.id);
  }
  const out: CriterionChange[] = [];
  for (const c of b.criteria) {
    const old = inA.get(c.id);
    if (old) {
      const fields = FIELDS.filter((f) => JSON.stringify(old[f] ?? null) !== JSON.stringify(c[f] ?? null)).map((f) => FIELD_RU[f]);
      out.push(fields.length ? { kind: "edited", id: c.id, fields } : { kind: "same", id: c.id });
    } else if (pairs.has(c.id)) out.push({ kind: "replaced", from: pairs.get(c.id)!, to: c.id });
    else out.push({ kind: "added", id: c.id });
  }
  const paired = new Set(pairs.values());
  for (const r of removed) if (!paired.has(r.id)) out.push({ kind: "removed", id: r.id });
  return out;
}

export interface Side {
  evaluationId: string;
  judgments: Judgment[];
  total: number | null;
  gross: boolean;
}

export interface CompareInput {
  dialogueId: string;
  language?: string;
  channel?: string;
  before: Side | null;
  after: Side | null;
}

export interface CompareRow {
  dialogueId: string;
  language?: string;
  channel?: string;
  beforeId: string | null;
  afterId: string | null;
  totalBefore: number | null;
  totalAfter: number | null;
  delta: number | null;
  grossBefore: boolean | null;
  grossAfter: boolean | null;
  /** Answers on the criteria the change touched (replaced / edited / added / removed): [criterion in B or A, before, after]. */
  touched: { id: string; before: Answer | null; after: Answer | null }[];
  /** Criteria the change did not touch whose answer still moved: run-to-run noise or side effects. */
  sideEffects: { id: string; before: Answer; after: Answer }[];
}

export interface CompareSummary {
  compared: number;
  onlyBefore: number;
  onlyAfter: number;
  totalChanged: number;
  meanDelta: number | null;
  meanAbsDelta: number | null;
  /** For every touched criterion: how many dialogues changed their answer, and the new answer distribution. */
  touched: { id: string; changed: number; distribution: Record<string, number> }[];
  sideEffectAnswers: number;
  untouchedAnswers: number;
}

const key = (a: Answer | null | undefined) => (a === null || a === undefined ? "—" : String(a));

export function compareRuns(a: Checklist, b: Checklist, input: CompareInput[]): { changes: CriterionChange[]; rows: CompareRow[]; summary: CompareSummary } {
  const changes = diffChecklists(a, b);
  const touchedIds = changes.filter((c) => c.kind !== "same");
  const untouched = changes.filter((c): c is { kind: "same"; id: string } => c.kind === "same").map((c) => c.id);
  const rows: CompareRow[] = [];
  const dist = new Map<string, { changed: number; distribution: Record<string, number> }>();
  let side = 0;
  let untouchedN = 0;
  for (const x of input) {
    const before = new Map((x.before?.judgments ?? []).map((j) => [j.criterionId, j.answer]));
    const after = new Map((x.after?.judgments ?? []).map((j) => [j.criterionId, j.answer]));
    const both = !!x.before && !!x.after;
    const touched = touchedIds.map((c) => {
      const [fromId, toId] = c.kind === "replaced" ? [c.from, c.to] : [c.id, c.id];
      return { id: toId, before: x.before ? before.get(fromId) ?? null : null, after: x.after ? after.get(toId) ?? null : null };
    });
    const sideEffects = both
      ? untouched.flatMap((id) => {
          const p = before.get(id);
          const q = after.get(id);
          if (p === undefined || q === undefined) return [];
          untouchedN++;
          return key(p) === key(q) ? [] : [{ id, before: p, after: q }];
        })
      : [];
    side += sideEffects.length;
    if (both)
      for (const t of touched) {
        const d = dist.get(t.id) ?? { changed: 0, distribution: {} };
        if (key(t.before) !== key(t.after)) d.changed++;
        d.distribution[key(t.after)] = (d.distribution[key(t.after)] ?? 0) + 1;
        dist.set(t.id, d);
      }
    const tb = x.before?.total ?? null;
    const ta = x.after?.total ?? null;
    rows.push({
      dialogueId: x.dialogueId,
      language: x.language,
      channel: x.channel,
      beforeId: x.before?.evaluationId ?? null,
      afterId: x.after?.evaluationId ?? null,
      totalBefore: tb,
      totalAfter: ta,
      delta: tb !== null && ta !== null ? Math.round((ta - tb) * 100) / 100 : null,
      grossBefore: x.before ? x.before.gross : null,
      grossAfter: x.after ? x.after.gross : null,
      touched,
      sideEffects,
    });
  }
  const deltas = rows.map((r) => r.delta).filter((d): d is number => d !== null);
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 100) / 100 : null);
  return {
    changes,
    rows,
    summary: {
      compared: rows.filter((r) => r.beforeId && r.afterId).length,
      onlyBefore: rows.filter((r) => r.beforeId && !r.afterId).length,
      onlyAfter: rows.filter((r) => !r.beforeId && r.afterId).length,
      totalChanged: deltas.filter((d) => d !== 0).length,
      meanDelta: mean(deltas),
      meanAbsDelta: mean(deltas.map(Math.abs)),
      touched: touchedIds.map((c) => {
        const id = c.kind === "replaced" ? c.to : c.id;
        return { id, ...(dist.get(id) ?? { changed: 0, distribution: {} }) };
      }),
      sideEffectAnswers: side,
      untouchedAnswers: untouchedN,
    },
  };
}
