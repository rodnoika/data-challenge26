import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { computeFacts, detectLanguage, renderFacts, toSeconds } from "../src/core/facts";
import { aggregate } from "../src/core/aggregate";
import { buildOutputSchema, parseJudgments } from "../src/core/prompt";
import { DEFAULT_CHECKLIST, migrateRules } from "../src/core/defaultChecklist";
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
    // the operator keeps talking to a colleague after "Агент вышел" while the client is on hold
    expect(f.turns[50].internal).toBe(true);
    expect(f.turns[59].internal).toBe(false);
  });

  it("first reply language matches the dialogue on every chat (p1-ru-013 has English section names)", () => {
    for (const d of dev.filter((x) => x.channel === "agent chat")) {
      expect(computeFacts(d).firstOperatorLanguage, d.conversation_id).toBe(d.language);
    }
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

describe("facts without DEV data", () => {
  const dialogue = (turns: [string, string][]): Dialogue => ({
    conversation_id: "t",
    channel: "voice call",
    language: "RU",
    audio_url: null,
    transcript: turns.map(([speaker, text], i) => ({ speaker, text, timestamp: `00:${String(i).padStart(2, "0")}` })),
  });
  const internal = (d: Dialogue) => computeFacts(d).turns.filter((t) => t.internal).map((t) => t.idx);

  it("keeps turns internal until the client is off hold, even after the colleague left", () => {
    const d = dialogue([
      ["system", "Инициирована консультация с агентом."],
      ["system", "Клиент находится на удержании."],
      ["operator", "Коллега, подскажи"],
      ["system", "Агент вышел из разговора."],
      ["operator", "Запишу себе"],
      ["system", "Клиент больше не находится на удержании."],
      ["operator", "Спасибо за ожидание"],
    ]);
    expect(internal(d)).toEqual([2, 4]);
    expect(computeFacts(d).holdWindows).toEqual([[0, 5]]);
  });

  it("closes a consultation without hold when the colleague leaves", () => {
    const d = dialogue([
      ["system", "Инициирована консультация с агентом."],
      ["operator", "Коллега, подскажи"],
      ["system", "Агент вышел из разговора."],
      ["operator", "Клиенту"],
    ]);
    expect(internal(d)).toEqual([1]);
  });

  it("does not take app section names for the language of the reply", () => {
    expect(detectLanguage(["Здравствуйте! Я Кира. На сайте Freedom Holding Corp. откройте Investors, затем Financial Information."])).toBe("RU");
    expect(detectLanguage(["Hi, I'm Adrian. Open Quotes and search by the bond's name or ticker."])).toBe("EN");
    expect(detectLanguage(["Okay"])).toBe("EN");
  });

  it("keeps reply times and the 3-minute threshold out of the prompt", () => {
    const d = dialogue([
      ["system", "Эскалация на оператора."],
      ["operator", "Здравствуйте"],
    ]);
    const rendered = renderFacts(computeFacts(d));
    expect(rendered).not.toMatch(/порог|реакци|пауза/i);
    expect(DEFAULT_CHECKLIST.rules).toMatch(/порог первой реакции в 3 минуты в этом задании в оценку не входит/);
    expect(DEFAULT_CHECKLIST.rules).not.toMatch(/больше порога ожидания/);
  });
});

describe("stored checklist migration", () => {
  const legacy =
    "10. Явное ожидание: оператор берёт паузу (проверяет, консультируется, ставит на удержание) или между репликой клиента и ответом оператора проходит больше порога ожидания (см. факты). Если ожидание было, а оператор не предупредил о нём заранее, это заметный сбой в ведении диалога (не выше ступени 7). Порог первой реакции — 3 минуты.";

  it("replaces the old wait rule and leaves other text alone", () => {
    const out = migrateRules(`9. x\n${legacy}\n11. y`);
    expect(out).not.toContain("больше порога ожидания");
    expect(out.startsWith("9. x\n10. Явное ожидание")).toBe(true);
    expect(out.endsWith("\n11. y")).toBe(true);
    expect(migrateRules("свои правила")).toBe("свои правила");
  });

  it("replaces the old closing rule and treats a bare goodbye as No", () => {
    const legacyClosing =
      "11. Завершение: если оператор закрыл чат без прощания — «Нет». Если клиент ушёл или связь прервалась до того, как оператор мог завершить разговор, — N/A.";
    const out = migrateRules(`10. x\n${legacyClosing}\n12. y`);
    expect(out).not.toContain(legacyClosing);
    expect(out).toContain("только попрощался без итога и без предложения помощи");
    expect(out.startsWith("10. x\n11. Завершение")).toBe(true);
    expect(out.endsWith("\n12. y")).toBe(true);
    expect(migrateRules(DEFAULT_CHECKLIST.rules)).toBe(DEFAULT_CHECKLIST.rules);
    expect(DEFAULT_CHECKLIST.rules).toContain("только попрощался без итога и без предложения помощи");
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
