import type { Checklist, Criterion, Dialogue, Judgment } from "./types";
import type { Facts } from "./facts";
import { formatClock, renderFacts } from "./facts";
import { allowedAnswers, parseAnswer } from "./scoring";

/**
 * The evaluator prompt is generated ONLY from the stored checklist (criteria + rules)
 * and the dialogue. A criterion added or replaced in the UI is evaluated with zero code changes.
 */

export const PROMPT_VERSION = "p3";

function renderCriterion(c: Criterion): string {
  const lines: string[] = [];
  const kind = c.isFlag
    ? "флаг (без баллов): yes = нарушение найдено, no = не найдено"
    : c.answerType === "yes_no"
      ? `Да/Нет${c.naAllowed ? "/N/A" : ""}, вес ${c.weight}`
      : `шкала${c.naAllowed ? " или N/A" : ""}, вес ${c.weight}`;
  lines.push(`### ${c.id} — ${c.code}. ${c.title} (${kind})`);
  lines.push(c.description.trim());
  if (c.answerType === "scale" && c.steps?.length) {
    lines.push("Ступени шкалы:");
    for (const s of [...c.steps].sort((a, b) => b.value - a.value)) lines.push(`  ${s.value} — ${s.description}`);
  }
  if (c.naAllowed && c.naCondition) lines.push(`N/A — ${c.naCondition.trim()}`);
  if (!c.naAllowed) lines.push("N/A для этого критерия не допускается.");
  if (c.guidance?.trim()) lines.push(`Подсказка: ${c.guidance.trim()}`);
  lines.push(`Допустимые ответы: ${allowedAnswers(c).join(", ")}`);
  return lines.join("\n");
}

export function buildSystemPrompt(cl: Checklist): string {
  const sectionTitle = new Map(cl.sections.map((s) => [s.id, s.title]));
  const bySection = new Map<string, Criterion[]>();
  for (const c of cl.criteria) {
    const k = c.sectionId;
    if (!bySection.has(k)) bySection.set(k, []);
    bySection.get(k)!.push(c);
  }
  const crit: string[] = [];
  for (const [sid, list] of bySection) {
    crit.push(`## Секция: ${sectionTitle.get(sid) ?? sid}`);
    for (const c of list) crit.push(renderCriterion(c));
  }
  return `Ты — эксперт по контролю качества (QA) клиентской поддержки брокера Freedom Broker. Ты оцениваешь работу ОПЕРАТОРА в одном диалоге (чат или расшифровка звонка) строго по чек-листу ниже. Диалоги бывают на русском, казахском и английском.

Как работать:
- Внимательно прочитай весь диалог и блок фактов. Факты вычислены программно по меткам времени и системным событиям — доверяй им.
- Оценивай каждый критерий независимо, буквально по его формулировке и общим правилам. Не завышай и не занижай оценку из-за других критериев.
- Номера реплик — индексы в квадратных скобках [i]. Ссылайся только на существующие номера.
- evidence_turn_ids — реплики, на которых основан вывод (реплика оператора, клиента или системное сообщение). Для «Нет» по пропущенному действию укажи checked_span — [первая, последняя] реплика участка, где действие ожидалось; иначе checked_span = [].
- na_reason — заполняй только при N/A (какое условие неприменимости выполнено), иначе пустая строка.
- explanation — 1–2 коротких предложения по-русски в стиле: «<Критерий> — <ответ>. <почему>. Основание — <какие реплики>».
- Ответ — только JSON по заданной схеме.

${cl.rules.trim()}

# ЧЕК-ЛИСТ «${cl.name}» (версия ${cl.version})
${crit.join("\n\n")}`;
}

export function renderTranscript(d: Dialogue, f: Facts): string {
  const internal = new Set(f.turns.filter((t) => t.internal).map((t) => t.idx));
  const dup = new Set(f.duplicateIdx);
  return d.transcript
    .map((t, i) => {
      const who = String(t.speaker).toUpperCase();
      const tags = [internal.has(i) ? "INTERNAL" : "", dup.has(i) ? "DUPLICATE" : ""].filter(Boolean).join(",");
      const clock = formatClock(f.turns[i]?.t ?? 0);
      return `[${i}] ${clock} ${who}${tags ? ` (${tags})` : ""}: ${t.text.replace(/\s+/g, " ").trim()}`;
    })
    .join("\n");
}

export function buildUserPrompt(d: Dialogue, f: Facts): string {
  return `Диалог ${d.conversation_id} · канал: ${d.channel} · язык набора: ${d.language}

ФАКТЫ (вычислены программно):
${renderFacts(f)}

ТРАНСКРИПТ (время — от начала диалога, мм:сс):
${renderTranscript(d, f)}

Оцени оператора по каждому критерию чек-листа.`;
}

/** JSON schema of the expected model output, generated from the checklist. */
export function buildOutputSchema(cl: Checklist): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const c of cl.criteria) {
    props[c.id] = {
      type: "object",
      additionalProperties: false,
      required: ["explanation", "evidence_turn_ids", "checked_span", "na_reason", "answer"],
      properties: {
        explanation: { type: "string" },
        evidence_turn_ids: { type: "array", items: { type: "integer" } },
        checked_span: { type: "array", items: { type: "integer" } },
        na_reason: { type: "string" },
        answer: { type: "string", enum: allowedAnswers(c) },
      },
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: cl.criteria.map((c) => c.id),
    properties: props,
  };
}

/** Extract the first JSON object from a model response (tolerates code fences). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("Model output is not JSON");
  }
}

/**
 * Convert raw model JSON into validated judgments.
 * Returns the judgments plus a list of problems (missing / invalid criteria).
 */
export function parseJudgments(
  cl: Checklist,
  raw: unknown,
  turnCount: number,
): { judgments: Judgment[]; problems: string[] } {
  const problems: string[] = [];
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const root = obj.criteria && typeof obj.criteria === "object" ? obj.criteria : obj;
  const inRange = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < turnCount;
  const judgments: Judgment[] = [];
  for (const c of cl.criteria) {
    const r = root[c.id];
    if (!r || typeof r !== "object") {
      problems.push(`${c.id}: missing`);
      continue;
    }
    const answer = parseAnswer(c, r.answer);
    if (answer === null) {
      problems.push(`${c.id}: invalid answer ${JSON.stringify(r.answer)}`);
      continue;
    }
    const ev = Array.isArray(r.evidence_turn_ids) ? r.evidence_turn_ids.filter(inRange) : [];
    const span = Array.isArray(r.checked_span) ? r.checked_span.filter(inRange) : [];
    judgments.push({
      criterionId: c.id,
      answer,
      explanation: String(r.explanation ?? "").trim(),
      evidenceTurnIds: [...new Set<number>(ev)].sort((a, b) => a - b),
      checkedSpan: span.length >= 2 ? [Math.min(span[0], span[1]), Math.max(span[0], span[1])] : null,
      naReason: answer === "na" ? String(r.na_reason ?? "").trim() || null : null,
      confidence: "high",
      votes: [answer],
    });
  }
  return { judgments, problems };
}
