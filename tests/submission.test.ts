import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { checklistFormatProblems, expectedFinalScore, shiftTurnRefs, submissionModel, toResult, validateSubmission, type Submission, type SubmissionCriterion } from "../src/core/submission";
import type { Answer, Judgment } from "../src/core/types";

const j = (criterionId: string, answer: Answer, turns: number[] = [0]): Judgment => ({
  criterionId,
  answer,
  explanation: `Ответ. Основание — [${turns.join(", ")}].`,
  evidenceTurnIds: turns,
  checkedSpan: null,
  naReason: null,
  confidence: "high",
  votes: [answer],
});

/** The organisers' example from page 2 of the appendix. */
const example: SubmissionCriterion[] = [
  { criterion_id: "contact", value: true, rationale: "r", evidence_turns: [4] },
  { criterion_id: "discovery", value: null, rationale: "r", evidence_turns: [1] },
  { criterion_id: "identification", value: null, rationale: "r", evidence_turns: [1] },
  { criterion_id: "consultation", value: 15, rationale: "r", evidence_turns: [5, 6] },
  { criterion_id: "empathy", value: true, rationale: "r", evidence_turns: [4, 5] },
  { criterion_id: "dialogue", value: 7, rationale: "r", evidence_turns: [5, 6] },
  { criterion_id: "closure", value: true, rationale: "r", evidence_turns: [8] },
  { criterion_id: "critical", value: false, rationale: "r", evidence_turns: [4, 5, 6, 8] },
];

const file = (over: Partial<Submission> = {}): Submission => ({
  schema_version: "1.0",
  team_name: "Команда",
  model: { mode: "external_api", name: "gpt-6.1-terra" },
  results: [{ conversation_id: "demo-001", status: "ok", criteria: example, score: { final_score: 85.38, critical_flag: false } }],
  ...over,
});

const answers = (over: Record<string, Answer> = {}) =>
  Object.entries({ c01: "yes", c02: "na", c03: "na", c04: 15, c05: "yes", c06: 7, c07: "yes", c08: "no", ...over } as Record<string, Answer>).map(([id, a]) => j(id, a, [3, 4]));

describe("results file", () => {
  it("accepts the organisers' own example and reproduces its score", () => {
    expect(expectedFinalScore(example)).toBe(85.38);
    expect(validateSubmission(file())).toEqual([]);
  });

  it("builds that example from our judgments", () => {
    const r = toResult("demo-001", DEFAULT_CHECKLIST, answers());
    expect(r.score).toEqual({ final_score: 85.38, critical_flag: false });
    expect(r.criteria.map((c) => c.criterion_id)).toEqual(["contact", "discovery", "identification", "consultation", "empathy", "dialogue", "closure", "critical"]);
    expect(r.criteria.map((c) => c.value)).toEqual([true, null, null, 15, true, 7, true, false]);
    expect(validateSubmission(file({ results: [r] }))).toEqual([]);
  });

  it("counts turns from 1 in evidence and in the rationale text", () => {
    const c = toResult("d", DEFAULT_CHECKLIST, answers()).criteria[0];
    expect(c.evidence_turns).toEqual([4, 5]);
    expect(c.rationale).toBe("Ответ. Основание — [4, 5].");
    expect(shiftTurnRefs("Основание — реплики [9], [15–18], [0, 11–12]. В 2026 году [Имя скрыто].")).toBe("Основание — реплики [10], [16–19], [1, 12–13]. В 2026 году [Имя скрыто].");
  });

  it("reports a failed dialogue instead of a zero", () => {
    const r = toResult("demo-002", DEFAULT_CHECKLIST, [], "Не удалось получить ответ модели.");
    expect(r).toEqual({ conversation_id: "demo-002", status: "error", criteria: [], score: null, error: "Не удалось получить ответ модели." });
    expect(validateSubmission(file({ results: [r] }))).toEqual([]);
  });

  it("flags a gross error without zeroing the score", () => {
    const r = toResult("d", DEFAULT_CHECKLIST, answers({ c08: "yes" }));
    expect(r.score).toEqual({ final_score: 85.38, critical_flag: true });
  });

  it("refuses a checklist whose criteria have no code in the format", () => {
    const cl = { ...DEFAULT_CHECKLIST, criteria: DEFAULT_CHECKLIST.criteria.map((c) => (c.id === "c07" ? { ...c, id: "n07" } : c)) };
    expect(() => toResult("d", cl, [])).toThrow(/n07/);
  });
});

describe("checklistFormatProblems", () => {
  const edit = (patch: Partial<(typeof DEFAULT_CHECKLIST)["criteria"][number]>) => ({
    ...DEFAULT_CHECKLIST,
    criteria: DEFAULT_CHECKLIST.criteria.map((c) => (c.id === "c07" ? { ...c, ...patch } : c)),
  });

  it("accepts the default checklist, also with a reworded rule", () => {
    expect(checklistFormatProblems(DEFAULT_CHECKLIST)).toEqual([]);
    expect(checklistFormatProblems(edit({ guidance: "Новая подсказка" }))).toEqual([]);
  });

  it("refuses a criterion replaced under the same id, a changed weight or scale, a missing one", () => {
    expect(checklistFormatProblems(edit({ title: "Предложение помощи" })).join()).toMatch(/Завершение/);
    expect(checklistFormatProblems(edit({ weight: 7 }))).toHaveLength(1);
    expect(checklistFormatProblems({ ...DEFAULT_CHECKLIST, criteria: DEFAULT_CHECKLIST.criteria.filter((c) => c.id !== "c07") }).join()).toMatch(/closure/);
  });
});

describe("submissionModel", () => {
  it("names the mode from the providers", () => {
    expect(submissionModel([{ provider: "openai", model: "gpt-6.1-terra" }])).toEqual({ mode: "external_api", name: "gpt-6.1-terra" });
    expect(submissionModel([{ provider: "ollama", model: "qwen3:14b" }])).toEqual({ mode: "local", name: "qwen3:14b" });
    expect(submissionModel([{ provider: "ollama", model: "qwen3:14b" }, { provider: "openai", model: "gpt-6.1-terra" }])).toEqual({ mode: "hybrid", name: "qwen3:14b, gpt-6.1-terra" });
  });
});

describe("validateSubmission catches what the format forbids", () => {
  const one = (patch: (c: SubmissionCriterion[]) => SubmissionCriterion[], score = { final_score: 85.38, critical_flag: false }) =>
    validateSubmission(file({ results: [{ conversation_id: "d", status: "ok", criteria: patch(example), score }] }));

  it("wrong count, duplicates and unknown or missing ids", () => {
    const r = file().results[0];
    expect(validateSubmission(file({ results: [r, r] }), { expectedCount: 10 }).join()).toMatch(/expected 10.*duplicate/);
    expect(validateSubmission(file(), { source: new Map([["other", 10]]) }).join()).toMatch(/not in the source.*other: missing/);
  });

  it("N/A where the format has none, a value off the scale, a missing criterion", () => {
    expect(one((c) => c.map((x) => (x.criterion_id === "contact" ? { ...x, value: null } : x))).join()).toMatch(/contact has invalid value null/);
    expect(one((c) => c.map((x) => (x.criterion_id === "dialogue" ? { ...x, value: 5 } : x))).join()).toMatch(/dialogue has invalid value 5/);
    expect(one((c) => c.slice(1)).join()).toMatch(/exactly once/);
  });

  it("turn numbers from 0 or past the end of the transcript", () => {
    expect(one((c) => c.map((x) => (x.criterion_id === "contact" ? { ...x, evidence_turns: [0] } : x))).join()).toMatch(/evidence_turns/);
    expect(validateSubmission(file(), { source: new Map([["demo-001", 5]]) }).join()).toMatch(/closure has invalid evidence_turns/);
  });

  it("a score or flag that disagrees with the values", () => {
    expect(one((c) => c, { final_score: 90, critical_flag: false }).join()).toMatch(/the values give 85.38/);
    expect(one((c) => c, { final_score: 85.38, critical_flag: true }).join()).toMatch(/differs from critical/);
  });
});
