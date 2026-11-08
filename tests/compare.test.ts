import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { compareRuns, diffChecklists, type Side } from "../src/core/compare";
import type { Answer, Checklist, Judgment } from "../src/core/types";

const A: Checklist = { ...DEFAULT_CHECKLIST, version: 1 };
const crit = (id: string) => A.criteria.find((c) => c.id === id)!;

/** c05 replaced in place by a new criterion c09 «Проактивность», same weight and section. */
const B: Checklist = {
  ...A,
  version: 2,
  criteria: A.criteria.map((c) => (c.id === "c05" ? { ...c, id: "c09", code: "09", title: "Проактивность", description: "Да — предложил полезное сверх вопроса." } : c)),
};

const side = (id: string, answers: Record<string, Answer>, total: number, gross = false): Side => ({
  evaluationId: id,
  judgments: Object.entries(answers).map(
    ([criterionId, answer]): Judgment => ({ criterionId, answer, explanation: "", evidenceTurnIds: [], checkedSpan: null, naReason: null, confidence: "high", votes: [answer] }),
  ),
  total,
  gross,
});
const base = { c01: "yes", c02: "na", c03: "na", c04: 20, c06: 10, c07: "yes", c08: "no" } as Record<string, Answer>;

describe("diffChecklists", () => {
  it("pairs a removed and an added criterion at the same position as a replacement", () => {
    const d = diffChecklists(A, B);
    expect(d.filter((c) => c.kind !== "same")).toEqual([{ kind: "replaced", from: "c05", to: "c09" }]);
  });

  it("reports wording or weight edits under the same id", () => {
    const edited: Checklist = { ...A, criteria: A.criteria.map((c) => (c.id === "c07" ? { ...c, description: "Новая формулировка", weight: 10 } : c)) };
    expect(diffChecklists(A, edited).find((c) => c.kind === "edited")).toEqual({ kind: "edited", id: "c07", fields: ["формулировка", "вес"] });
  });

  it("reports a criterion that was only added or only removed", () => {
    const more: Checklist = { ...A, criteria: [...A.criteria, { ...crit("c07"), id: "c10", title: "Новый" }] };
    expect(diffChecklists(A, more).filter((c) => c.kind !== "same")).toEqual([{ kind: "added", id: "c10" }]);
    const less: Checklist = { ...A, criteria: A.criteria.filter((c) => c.id !== "c02") };
    expect(diffChecklists(A, less).filter((c) => c.kind !== "same")).toEqual([{ kind: "removed", id: "c02" }]);
  });
});

describe("compareRuns", () => {
  const out = compareRuns(A, B, [
    { dialogueId: "d1", before: side("e1", { ...base, c05: "yes" }, 100), after: side("e2", { ...base, c09: "no" }, 84.62) },
    { dialogueId: "d2", before: side("e3", { ...base, c05: "yes" }, 100), after: side("e4", { ...base, c09: "yes", c06: 7 }, 93.08) },
    { dialogueId: "d3", before: side("e5", { ...base, c05: "no" }, 84.62), after: null },
  ]);

  it("shows the replaced criterion's answer before and after, per dialogue", () => {
    expect(out.rows[0].touched).toEqual([{ id: "c09", before: "yes", after: "no" }]);
    expect(out.rows[0].delta).toBe(-15.38);
    expect(out.rows[2]).toMatchObject({ afterId: null, delta: null, touched: [{ id: "c09", before: "no", after: null }] });
  });

  it("counts answers that moved on criteria the change did not touch", () => {
    expect(out.rows[0].sideEffects).toEqual([]);
    expect(out.rows[1].sideEffects).toEqual([{ id: "c06", before: 10, after: 7 }]);
    expect(out.summary).toMatchObject({ compared: 2, onlyBefore: 1, onlyAfter: 0, totalChanged: 2, sideEffectAnswers: 1, untouchedAnswers: 14 });
  });

  it("summarises the new criterion's answers over the compared dialogues", () => {
    expect(out.summary.touched).toEqual([{ id: "c09", changed: 1, distribution: { no: 1, yes: 1 } }]);
    expect(out.summary.meanDelta).toBe(-11.15);
  });
});
