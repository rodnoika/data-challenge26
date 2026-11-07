import type { Answer, Checklist, Judgment } from "./types";
import { score } from "./scoring";

/**
 * Benchmark metrics and the model decision rule (PLAN.md §6a). Pure functions shared by
 * the bench/compare scripts and the "Сравнение моделей" page.
 */

export type Labels = Map<string, Record<string, Answer>>;

export interface Prediction {
  id: string;
  judgments: Judgment[];
  total: number | null;
  costUsd: number | null;
  latencyMs: number;
  votes: number;
  invalidVotes: number;
  error?: string;
}

export interface CandidateMetrics {
  candidate: string; // display label, e.g. "openai/gpt-6.1-sol ×1"
  provider: string; // vendor, or "ensemble"
  model: string;
  tier: string;
  samples: number;
  dialogues: number;
  judged: number; // labelled criterion judgments compared
  agreement: number; // micro exact agreement 0..1
  ci: [number, number]; // 95% cluster-bootstrap interval over dialogues
  perCriterion: Record<string, { n: number; exact: number; within1: number }>;
  kzAgreement: number | null;
  totalMAE: number | null;
  gross: { tp: number; fp: number; fn: number; recall: number | null };
  invalidRate: number; // votes whose first output failed validation
  failRate: number; // dialogues with no usable output
  costPerDialogue: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
}

const langOf = (id: string) => (id.match(/-(ru|kz|en)-/i)?.[1] ?? "").toUpperCase();

function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function pct(sorted: number[], p: number) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export function computeMetrics(
  cl: Checklist,
  labels: Labels,
  preds: Prediction[],
  meta: { candidate: string; provider: string; model: string; tier: string; samples: number },
  langByDialogue?: Map<string, string>,
): CandidateMetrics {
  const perCriterion: CandidateMetrics["perCriterion"] = {};
  const perDialogue: { id: string; n: number; exact: number }[] = [];
  const maes: number[] = [];
  const gross = { tp: 0, fp: 0, fn: 0 };
  let kzN = 0;
  let kzE = 0;

  for (const p of preds) {
    const gold = labels.get(p.id);
    if (!gold) continue;
    const pm = new Map(p.judgments.map((j) => [j.criterionId, j.answer]));
    let n = 0;
    let exact = 0;
    const lang = langByDialogue?.get(p.id) ?? langOf(p.id);
    for (const c of cl.criteria) {
      if (!(c.id in gold)) continue;
      const g = gold[c.id];
      const pr = pm.get(c.id);
      const st = (perCriterion[c.id] ??= { n: 0, exact: 0, within1: 0 });
      const ok = pr !== undefined && String(pr) === String(g);
      st.n++;
      n++;
      if (ok) (st.exact++, exact++);
      if (c.answerType === "scale" && typeof g === "number" && typeof pr === "number") {
        const steps = (c.steps ?? []).map((s) => s.value).sort((a, b) => a - b);
        if (Math.abs(steps.indexOf(g) - steps.indexOf(pr)) <= 1) st.within1++;
      } else if (ok) st.within1++;
      if (lang === "KZ") (kzN++, ok && kzE++);
      if (c.isFlag) {
        if (g === "yes" && pr === "yes") gross.tp++;
        else if (g !== "yes" && pr === "yes") gross.fp++;
        else if (g === "yes" && pr !== "yes") gross.fn++;
      }
    }
    perDialogue.push({ id: p.id, n, exact });
    const complete = cl.criteria.every((c) => c.id in gold);
    if (complete && p.total !== null && !p.error) {
      const gt = score(
        cl,
        cl.criteria.map((c) => ({ criterionId: c.id, answer: gold[c.id], explanation: "", evidenceTurnIds: [], checkedSpan: null, naReason: null, confidence: "high" as const, votes: [] })),
      ).total;
      if (gt !== null) maes.push(Math.abs(gt - p.total));
    }
  }

  const N = perDialogue.reduce((a, d) => a + d.n, 0);
  const E = perDialogue.reduce((a, d) => a + d.exact, 0);
  // cluster bootstrap over dialogues
  const rnd = seededRandom(42);
  const boots: number[] = [];
  for (let b = 0; b < 1000 && perDialogue.length; b++) {
    let n = 0;
    let e = 0;
    for (let i = 0; i < perDialogue.length; i++) {
      const d = perDialogue[Math.floor(rnd() * perDialogue.length)];
      n += d.n;
      e += d.exact;
    }
    boots.push(n ? e / n : 0);
  }
  boots.sort((a, b) => a - b);

  const votes = preds.reduce((a, p) => a + p.votes, 0);
  const invalid = preds.reduce((a, p) => a + p.invalidVotes, 0);
  const costs = preds.map((p) => p.costUsd);
  const lat = preds.filter((p) => !p.error).map((p) => p.latencyMs).sort((a, b) => a - b);

  return {
    ...meta,
    dialogues: perDialogue.length,
    judged: N,
    agreement: N ? E / N : 0,
    ci: [pct(boots, 0.025) ?? 0, pct(boots, 0.975) ?? 0],
    perCriterion,
    kzAgreement: kzN ? kzE / kzN : null,
    totalMAE: maes.length ? maes.reduce((a, b) => a + b, 0) / maes.length : null,
    gross: { ...gross, recall: gross.tp + gross.fn ? gross.tp / (gross.tp + gross.fn) : null },
    invalidRate: votes ? invalid / votes : 0,
    failRate: preds.length ? preds.filter((p) => p.error).length / preds.length : 0,
    costPerDialogue: costs.length && costs.every((c) => c !== null) ? (costs as number[]).reduce((a, b) => a + b, 0) / costs.length : null,
    latencyP50: pct(lat, 0.5),
    latencyP95: pct(lat, 0.95),
  };
}

export interface Decision {
  winner: string | null;
  fallback: string | null;
  tied: string[];
  excluded: { candidate: string; reason: string }[];
  rule: string;
}

/**
 * Gates: every labelled gross error caught (recall = 1), invalid-output rate < 5%, failure rate < 5%,
 * cost per dialogue within the cap. Then: highest agreement; anything whose agreement is at or above
 * the leader's lower 95% bound is a tie; ties go to lower cost, then lower median latency.
 * Fallback: the best remaining candidate from a different vendor.
 */
export function decide(rows: CandidateMetrics[], costCap: number): Decision {
  const excluded: Decision["excluded"] = [];
  const ok = rows.filter((r) => {
    const why =
      r.gross.recall !== null && r.gross.recall < 1 ? `пропущены грубые ошибки (recall ${(r.gross.recall * 100).toFixed(0)}%)`
      : r.invalidRate >= 0.05 ? `невалидный вывод ${(r.invalidRate * 100).toFixed(1)}%`
      : r.failRate >= 0.05 ? `сбои ${(r.failRate * 100).toFixed(1)}%`
      : r.costPerDialogue === null ? "цена не проверена"
      : r.costPerDialogue > costCap ? `дороже лимита $${costCap}`
      : null;
    if (why) excluded.push({ candidate: r.candidate, reason: why });
    return !why;
  });
  const rule = `гейты: recall грубых ошибок = 100%, невалидный вывод < 5%, сбои < 5%, цена ≤ $${costCap}/диалог; затем max согласие, ничья в пределах 95% ДИ лидера → дешевле → быстрее`;
  if (!ok.length) return { winner: null, fallback: null, tied: [], excluded, rule };
  const leader = [...ok].sort((a, b) => b.agreement - a.agreement)[0];
  const tied = ok.filter((r) => r.agreement >= leader.ci[0]);
  const byCost = (a: CandidateMetrics, b: CandidateMetrics) =>
    (a.costPerDialogue ?? Infinity) - (b.costPerDialogue ?? Infinity) || (a.latencyP50 ?? Infinity) - (b.latencyP50 ?? Infinity);
  const winner = [...tied].sort(byCost)[0];
  const vendors = (r: CandidateMetrics) => (r.provider === "ensemble" ? r.model.split("+").map((x) => x.split("/")[0]) : [r.provider]);
  const wv = new Set(vendors(winner));
  const fb = ok
    .filter((r) => r !== winner && vendors(r).every((v) => !wv.has(v)))
    .sort((a, b) => b.agreement - a.agreement || byCost(a, b))[0];
  return { winner: winner.candidate, fallback: fb?.candidate ?? null, tied: tied.map((t) => t.candidate), excluded, rule };
}
