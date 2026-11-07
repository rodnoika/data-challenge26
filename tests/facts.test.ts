import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { computeFacts, detectLanguage, toSeconds } from "../src/core/facts";
import { aggregate } from "../src/core/aggregate";
import { buildOutputSchema, parseJudgments } from "../src/core/prompt";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import type { Dialogue } from "../src/core/types";

// data/dev.json is not committed (it contains signed links); run `npm run fetch:dataset -- DEV` first.
const HAS_DEV = existsSync("data/dev.json");
const dev: Dialogue[] = HAS_DEV ? JSON.parse(readFileSync("data/dev.json", "utf8")).data.records : [];
const get = (id: string) => dev.find((d) => d.conversation_id === id)!;

describe.skipIf(!HAS_DEV)("facts on DEV", () => {
  it("parses both timestamp formats", () => {
    expect(toSeconds("01:15")).toBe(75);
    expect(toSeconds("2026-11-03T13:10:15.5558925+00:00")! - toSeconds("2026-11-03T13:10:00.6388245+00:00")!).toBeCloseTo(14.917, 2);
  });

  it("detects client language", () => {
    expect(detectLanguage(["Қазір қай тарифте тұрғанымды қайдан көремін?"])).toBe("KZ");
    expect(detectLanguage(["Где посмотреть мой тариф?"])).toBe("RU");
    expect(detectLanguage(["I'm opening a new account"])).toBe("EN");
  });

  it("chat template facts (p1-ru-001)", () => {
    const f = computeFacts(get("p1-ru-001"));
    expect(f.escalationIdx).toBe(8);
    expect(f.firstOperatorIdx).toBe(9);
    expect(f.firstReactionSec).toBe(37);
    expect(f.clientLanguage).toBe("RU");
    expect(f.endType).toBe("none");
  });

  it("identity event, endings and language across the set", () => {
    expect(computeFacts(get("p1-ru-006")).identityVerifiedIdx).toBe(11);
    expect(computeFacts(get("p1-ru-018")).endType).toBe("operator_closed");
    expect(computeFacts(get("p1-ru-025")).endType).toBe("client_left");
    expect(computeFacts(get("p1-ru-012")).endType).toBe("connection_lost");
    for (const d of dev.filter((x) => x.channel === "agent chat")) {
      expect(computeFacts(d).clientLanguage, d.conversation_id).toBe(d.language);
    }
  });

  it("voice call: hold window makes consultation turns internal (p4-ru-002)", () => {
    const f = computeFacts(get("p4-ru-002"));
    expect(f.channel).toBe("voice");
    expect(f.holdWindows.length).toBeGreaterThan(0);
    expect(f.turns.filter((t) => t.internal).length).toBeGreaterThan(0);
    expect(f.turns[20].internal).toBe(true);
  });

  it("voice call audio offsets are monotonic", () => {
    const f = computeFacts(get("p4-ru-003"));
    const offs = f.turns.map((t) => t.audioOffset!);
    for (let i = 1; i < offs.length; i++) expect(offs[i]).toBeGreaterThanOrEqual(offs[i - 1] - 0.01);
  });

  it("every DEV dialogue produces facts without throwing", () => {
    for (const d of dev) expect(() => computeFacts(d)).not.toThrow();
  });
});

describe("prompt schema + aggregation", () => {
  it("schema has one required object per criterion with the allowed answers", () => {
    const s = buildOutputSchema(DEFAULT_CHECKLIST) as any;
    expect(s.required).toEqual(DEFAULT_CHECKLIST.criteria.map((c) => c.id));
    expect(s.properties.c04.properties.answer.enum).toEqual(["0", "5", "10", "15", "20", "na"]);
    expect(s.properties.c01.properties.answer.enum).toEqual(["yes", "no"]);
  });

  it("majority vote and median with low confidence on disagreement", () => {
    const mk = (a: Record<string, string>) =>
      parseJudgments(
        DEFAULT_CHECKLIST,
        Object.fromEntries(
          Object.entries(a).map(([k, v]) => [k, { answer: v, explanation: "", evidence_turn_ids: [1], checked_span: [], na_reason: "" }]),
        ),
        10,
      ).judgments;
    const base = { c01: "yes", c02: "na", c03: "na", c04: "20", c05: "yes", c06: "10", c07: "yes", c08: "no" };
    const out = aggregate(DEFAULT_CHECKLIST, [
      mk(base),
      mk({ ...base, c04: "15", c06: "7" }),
      mk({ ...base, c01: "no", c04: "10" }),
    ]);
    const by = Object.fromEntries(out.map((j) => [j.criterionId, j]));
    expect(by.c01.answer).toBe("yes");
    expect(by.c01.confidence).toBe("low");
    expect(by.c04.answer).toBe(15);
    expect(by.c06.answer).toBe(10);
    expect(by.c05.confidence).toBe("high");
  });
});
