import { describe, expect, it } from "vitest";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { round2, score, validateChecklist } from "../src/core/scoring";
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

describe("rounding", () => {
  it("rounds half up to 2 decimals, as the organisers confirmed", () => {
    expect(round2(50.625)).toBe(50.63);
    expect(round2(50.62499999999999)).toBe(50.63);
    expect(round2(25.625)).toBe(25.63);
    expect(round2(50.624)).toBe(50.62);
  });

  it("matches exact arithmetic for every combination of answers in the default checklist", () => {
    const yn = ["yes", "no"] as const;
    const yna = ["yes", "no", "na"] as const;
    const c04 = [0, 5, 10, 15, 20, "na"] as const;
    const c06 = [0, 4, 7, 10] as const;
    // c04 points are step (weight 20, top 20); c06 points are 1.5 x step, so doubling keeps every value whole.
    const points = (a: "yes" | "no" | "na", w: number) => (a === "yes" ? 2 * w : 0);
    let checked = 0;
    for (const a1 of yna) for (const a2 of yna) for (const a3 of yna) for (const a4 of c04) for (const a5 of yn) for (const a6 of c06) for (const a7 of yna) {
      if (a1 === "na") continue;
      const weight = 10 + (a2 === "na" ? 0 : 15) + (a3 === "na" ? 0 : 20) + (a4 === "na" ? 0 : 20) + 15 + 15 + (a7 === "na" ? 0 : 5);
      const doubled = points(a1, 10) + points(a2, 15) + points(a3, 20) + (a4 === "na" ? 0 : 2 * a4) + points(a5, 15) + 3 * a6 + points(a7, 5);
      // total = doubled * 50 / weight; half up at 2 decimals = floor(total * 100 + 1/2), in whole numbers only
      const exact = Math.floor((doubled * 10000 + weight) / (2 * weight)) / 100;
      const r = score(DEFAULT_CHECKLIST, all({ c01: a1, c02: a2, c03: a3, c04: a4, c05: a5, c06: a6, c07: a7, c08: "no" }));
      expect(r.total).toBe(exact);
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("score", () => {
  it("a greeting missing from a call recording is N/A and its weight is redistributed", () => {
    const r = score(DEFAULT_CHECKLIST, all({ c01: "na", c02: "yes", c03: "yes", c04: 20, c05: "yes", c06: 10, c07: "yes", c08: "no" }));
    expect(r.total).toBe(100);
    expect(r.criteria.find((c) => c.criterionId === "c01")!.applicable).toBe(false);
  });

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
