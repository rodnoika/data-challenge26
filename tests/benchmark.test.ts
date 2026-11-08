import { describe, expect, it } from "vitest";
import { computeMetrics, decide, type CandidateMetrics, type Labels, type Prediction, cohenKappa, quadraticKappa } from "../src/core/benchmark";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { costUsd, defaultModel, loadRegistry } from "../src/server/registry";
import { buildOutputSchema } from "../src/core/prompt";
import type { Answer, Judgment } from "../src/core/types";

const J = (criterionId: string, answer: Answer): Judgment => ({
  criterionId, answer, explanation: "", evidenceTurnIds: [], checkedSpan: null, naReason: null, confidence: "high", votes: [answer],
});

const gold: Record<string, Answer> = { c01: "yes", c02: "na", c03: "na", c04: 20, c05: "yes", c06: 10, c07: "yes", c08: "no" };
const goldGross: Record<string, Answer> = { ...gold, c08: "yes", c05: "no" };

function pred(id: string, a: Record<string, Answer>, extra: Partial<Prediction> = {}): Prediction {
  return { id, judgments: Object.entries(a).map(([k, v]) => J(k, v)), total: 100, costUsd: 0.01, latencyMs: 1000, votes: 1, invalidVotes: 0, ...extra };
}

describe("benchmark metrics", () => {
  const labels: Labels = new Map([
    ["p1-ru-001", gold],
    ["p1-kz-001", gold],
    ["p1-ru-022", goldGross],
  ]);

  it("agreement, KZ agreement, gross recall and MAE", () => {
    const m = computeMetrics(
      DEFAULT_CHECKLIST,
      labels,
      [pred("p1-ru-001", gold), pred("p1-kz-001", { ...gold, c04: 15 }), pred("p1-ru-022", { ...goldGross, c08: "no" })],
      { candidate: "x", provider: "openai", model: "m", tier: "cheap", samples: 1 },
    );
    expect(m.judged).toBe(24);
    expect(m.agreement).toBeCloseTo(22 / 24, 5);
    expect(m.kzAgreement).toBeCloseTo(7 / 8, 5);
    expect(m.gross).toMatchObject({ tp: 0, fn: 1, recall: 0 });
    expect(m.ci[0]).toBeLessThanOrEqual(m.agreement);
    expect(m.ci[1]).toBeGreaterThanOrEqual(m.agreement);
    expect(m.totalMAE).not.toBeNull();
  });
});

const row = (candidate: string, provider: string, agreement: number, ci: [number, number], cost: number | null, extra: Partial<CandidateMetrics> = {}): CandidateMetrics => ({
  candidate, provider, model: candidate, tier: "x", samples: 1, dialogues: 20, judged: 160, agreement, ci, perCriterion: {}, kappaMean: null, kzAgreement: null,
  totalMAE: null, gross: { tp: 4, fp: 0, fn: 0, recall: 1 }, invalidRate: 0, failRate: 0, costPerDialogue: cost, latencyP50: 1000, latencyP95: 2000, ...extra,
});

describe("decision rule", () => {
  it("ties within the leader's CI go to the cheaper model; fallback is another vendor", () => {
    const d = decide(
      [
        row("A-frontier", "anthropic", 0.9, [0.86, 0.94], 0.1),
        row("O-cheap", "openai", 0.88, [0.84, 0.92], 0.005),
        row("A-cheap", "anthropic", 0.8, [0.75, 0.85], 0.002),
        row("G-front", "gemini", 0.87, [0.83, 0.91], 0.03),
      ],
      0.15,
    );
    expect(d.tied.sort()).toEqual(["A-frontier", "G-front", "O-cheap"]);
    expect(d.winner).toBe("O-cheap");
    expect(d.fallback).toBe("A-frontier");
  });

  it("gates exclude missed gross errors, invalid output, unknown or over-cap cost", () => {
    const d = decide(
      [
        row("best-but-misses-gross", "openai", 0.95, [0.92, 0.97], 0.01, { gross: { tp: 3, fp: 0, fn: 1, recall: 0.75 } }),
        row("invalid", "gemini", 0.94, [0.9, 0.96], 0.01, { invalidRate: 0.1 }),
        row("no-price", "ollama", 0.93, [0.9, 0.96], null),
        row("too-expensive", "anthropic", 0.93, [0.9, 0.96], 0.5),
        row("ok", "anthropic", 0.85, [0.8, 0.9], 0.05),
      ],
      0.15,
    );
    expect(d.winner).toBe("ok");
    expect(d.excluded.map((e) => e.candidate).sort()).toEqual(["best-but-misses-gross", "invalid", "no-price", "too-expensive"]);
  });
});

describe("registry", () => {
  it("every entry has provider, tier and a dated price source (except local)", () => {
    const r = loadRegistry();
    const vendors = new Set(r.models.filter((m) => m.tier !== "local").map((m) => m.provider));
    expect([...vendors].sort()).toEqual(["anthropic", "gemini", "openai"]);
    for (const v of vendors) {
      const tiers = new Set(r.models.filter((m) => m.provider === v).map((m) => m.tier));
      expect(tiers.has("frontier") && tiers.has("cheap"), v).toBe(true);
    }
    expect(r.models.some((m) => m.tier === "local")).toBe(true);
    for (const m of r.models.filter((m) => m.provider !== "ollama")) {
      expect(m.checkedAt, m.model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m.priceSource, m.model).toMatch(/^https:\/\//);
    }
  });

  it("cost uses registry prices, including cached input; unknown model -> null", () => {
    const u = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
    const m = loadRegistry().models.find((x) => x.provider === "openai" && x.tier === "cheap")!;
    expect(costUsd(m.provider, m.model, u)).toBeCloseTo(m.price!.in + m.price!.out + (m.price!.cachedIn ?? m.price!.in), 6);
    expect(costUsd("openai", "no-such-model", u)).toBeNull();
  });

  it("default never hard-codes a vendor: placeholder label until a benchmark result exists", () => {
    const d = defaultModel();
    if (!loadRegistry().default) expect(d.chosenBy).toMatch(/placeholder/);
  });

  it("output schema uses only the cross-vendor strict subset", () => {
    const s = JSON.stringify(buildOutputSchema(DEFAULT_CHECKLIST));
    for (const banned of ["anyOf", "oneOf", "nullable", "minimum", "maximum", "pattern", "format"]) expect(s).not.toContain(`"${banned}"`);
  });
});

describe("agreement corrected for chance", () => {
  it("Cohen's κ on the textbook 2x2 table", () => {
    const pairs: [string, string][] = [
      ...Array(20).fill(["yes", "yes"]),
      ...Array(5).fill(["yes", "no"]),
      ...Array(10).fill(["no", "yes"]),
      ...Array(15).fill(["no", "no"]),
    ];
    expect(cohenKappa(pairs)).toBeCloseTo(0.4, 10);
    expect(cohenKappa([["yes", "yes"], ["yes", "yes"]])).toBeNull();
  });

  it("quadratic κ rewards near misses on a scale", () => {
    expect(quadraticKappa([[0, 0], [5, 5], [10, 10]], [0, 5, 10])).toBe(1);
    expect(quadraticKappa([[0, 10], [5, 5], [10, 0]], [0, 5, 10])).toBeCloseTo(-1, 10);
    const near = quadraticKappa([[0, 5], [5, 5], [10, 10], [10, 10]], [0, 5, 10])!;
    const far = quadraticKappa([[0, 10], [5, 5], [10, 10], [10, 10]], [0, 5, 10])!;
    expect(near).toBeGreaterThan(far);
  });
});
