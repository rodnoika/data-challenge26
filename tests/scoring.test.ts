import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { score, validateChecklist } from "../src/core/scoring";
import type { Answer, Checklist, Judgment } from "../src/core/types";

const j = (criterionId: string, answer: Answer): Judgment => ({
  criterionId,
  answer,
  explanation: "",
  evidenceTurnIds: [],
  checkedSpan: null,
  naReason: null,
  confidence: "high",
  votes: [answer],
});

const all = (a: Record<string, Answer>) => Object.entries(a).map(([k, v]) => j(k, v));

describe("score", () => {
  it("perfect dialogue = 100", () => {
    const r = score(DEFAULT_CHECKLIST, all({ c01: "yes", c02: "yes", c03: "yes", c04: 20, c05: "yes", c06: 10, c07: "yes", c08: "no" }));
    expect(r.total).toBe(100);
    expect(r.grossError).toBe(false);
  });

  it("scale steps convert proportionally", () => {
    const r = score(DEFAULT_CHECKLIST, all({ c01: "yes", c02: "yes", c03: "yes", c04: 15, c05: "yes", c06: 7, c07: "yes", c08: "no" }));
    // 10+15+20+15+15+10.5+5 = 90.5
    expect(r.total).toBe(90.5);
  });

  it("redistributes N/A weight so the maximum stays 100", () => {
    const r = score(DEFAULT_CHECKLIST, all({ c01: "yes", c02: "na", c03: "na", c04: 20, c05: "yes", c06: 10, c07: "no", c08: "no" }));
    // applicable weights: 10+20+15+15+5 = 65; earned 60 -> 60*100/65
    expect(r.total).toBe(92.31);
    const max = r.criteria.reduce((a, c) => a + c.maxPoints, 0);
    expect(Math.round(max * 1000) / 1000).toBe(100);
  });

  it("gross error is flagged but does not change the total", () => {
    const a = score(DEFAULT_CHECKLIST, all({ c01: "yes", c02: "yes", c03: "na", c04: 0, c05: "no", c06: 4, c07: "no", c08: "no" }));
    const b = score(DEFAULT_CHECKLIST, all({ c01: "yes", c02: "yes", c03: "na", c04: 0, c05: "no", c06: 4, c07: "no", c08: "yes" }));
    expect(b.grossError).toBe(true);
    expect(b.grossCriteria).toEqual(["c08"]);
    expect(a.total).toBe(b.total);
  });

  it("no total when no weighted criterion applies", () => {
    const cl: Checklist = {
      ...DEFAULT_CHECKLIST,
      criteria: DEFAULT_CHECKLIST.criteria.filter((c) => c.naAllowed || c.isFlag),
    };
    const r = score(cl, all({ c02: "na", c03: "na", c04: "na", c07: "na", c08: "no" }));
    expect(r.total).toBeNull();
  });

  it("section subtotals add up to the total", () => {
    const r = score(DEFAULT_CHECKLIST, all({ c01: "no", c02: "na", c03: "yes", c04: 10, c05: "yes", c06: 7, c07: "na", c08: "no" }));
    const sum = r.sections.reduce((a, s) => a + s.points, 0);
    expect(Math.abs(sum - (r.total ?? 0))).toBeLessThan(0.02);
  });

  it("a new criterion with a custom scale is scored from config alone", () => {
    const cl: Checklist = {
      ...DEFAULT_CHECKLIST,
      criteria: [
        ...DEFAULT_CHECKLIST.criteria,
        {
          id: "c09",
          code: "09",
          sectionId: "s3",
          title: "Проактивность",
          description: "test",
          answerType: "scale",
          steps: [
            { value: 0, description: "a" },
            { value: 1, description: "b" },
            { value: 2, description: "c" },
          ],
          naAllowed: false,
          weight: 10,
          isFlag: false,
        },
      ],
    };
    expect(validateChecklist(cl)).toEqual([]);
    const r = score(cl, all({ c01: "yes", c02: "yes", c03: "yes", c04: 20, c05: "yes", c06: 10, c07: "yes", c08: "no", c09: 1 }));
    // 100 earned + 5 of 10 -> 105/110*100
    expect(r.total).toBe(95.45);
  });

  it("default checklist is valid and weights sum to 100", () => {
    expect(validateChecklist(DEFAULT_CHECKLIST)).toEqual([]);
    expect(DEFAULT_CHECKLIST.criteria.reduce((a, c) => a + c.weight, 0)).toBe(100);
  });
});
