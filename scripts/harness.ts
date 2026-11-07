// Accuracy harness for ONE candidate (prompt/rules iteration). For model comparison use `npm run bench`.
//
//   npm run harness -- --model openai/gpt-6.1-sol [--samples 1] [--split tune|holdout|all] [--ids a,b]
//   npm run harness -- --ensemble "anthropic/claude-opus-5-5,openai/gpt-6.1-sol,gemini/gemini-4-argon"
//   npm run harness -- --from runs/<file>.json      re-score a saved run against current labels (no API calls)
//   (no --model: uses the configured default from config/models.json)
import "./env";
import { readFileSync } from "node:fs";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { PROMPT_VERSION } from "../src/core/prompt";
import { computeMetrics } from "../src/core/benchmark";
import { defaultModel, findModel } from "../src/server/registry";
import { sameModel, voterLabel } from "../src/server/evaluator";
import type { Checklist } from "../src/core/types";
import type { Reasoning } from "../src/server/providers";
import { detailRows, fmtPct, fmtUsd, loadDialogues, parseArgs, parseVoter, readLabels, runCandidate, split, writeRunFiles, type FullPrediction } from "./lib";

const a = parseArgs();
const cl: Checklist = a.checklist ? JSON.parse(readFileSync(a.checklist, "utf8")) : DEFAULT_CHECKLIST;
const labels = readLabels(a.labels ?? "data/labels/dev-labels.csv", cl);
const reasoning = (a.reasoning ?? "medium") as Reasoning;

let preds: FullPrediction[];
let label: string;
let tier = "?";
let provider: string;
let model: string;
let samples: number;

if (a.from) {
  const prev = JSON.parse(readFileSync(a.from, "utf8"));
  preds = prev.predictions;
  label = prev.meta.candidate;
  ({ provider, model } = voterLabel(prev.meta.voters));
  samples = prev.meta.voters.length;
} else {
  const def = defaultModel();
  const voters = a.ensemble
    ? a.ensemble.split(",").map((s) => parseVoter(s.trim()))
    : (() => {
        const v = a.model ? parseVoter(a.model) : { provider: (a.provider ?? def.provider) as any, model: def.model };
        return sameModel(v.provider, v.model, Number(a.samples ?? 1));
      })();
  ({ provider, model, label } = voterLabel(voters));
  tier = a.ensemble ? "ensemble" : findModel(voters[0].provider, voters[0].model)?.tier ?? "?";
  samples = voters.length;
  const all = loadDialogues(a.data ?? "data/dev.json");
  let ids = a.ids ? a.ids.split(",") : all.map((d) => d.conversation_id);
  if (!a.ids && labels.size) ids = split(ids.filter((id) => labels.has(id)), a.split ?? "all");
  const todo = all.filter((d) => ids.includes(d.conversation_id));
  console.log(`Evaluating ${todo.length} dialogues · ${label} ×${samples} · prompt ${PROMPT_VERSION} · reasoning ${reasoning}`);
  preds = await runCandidate(todo, cl, voters, reasoning, Number(a.concurrency ?? 4));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `runs/${stamp}-${label.replace(/[^a-z0-9.+-]/gi, "_")}`;
  const m0 = computeMetrics(cl, labels, preds, { candidate: label, provider, model, tier, samples });
  writeRunFiles(base, { meta: { candidate: label, voters, reasoning, promptVersion: PROMPT_VERSION, split: a.split ?? "all" }, metrics: m0, predictions: preds }, detailRows(cl, labels, preds, label));
  console.log(`Saved ${base}.json / .csv`);
}

const m = computeMetrics(cl, labels, preds, { candidate: label, provider, model, tier, samples });
console.log(`\nLabels: ${labels.size} · predictions: ${preds.length} · failed: ${preds.filter((p) => p.error).length}`);
for (const c of cl.criteria) {
  const s = m.perCriterion[c.id];
  if (s) console.log(`${c.id} ${c.title.slice(0, 42).padEnd(42)} exact ${fmtPct(s.exact / s.n).padStart(6)}  ±1 ${fmtPct(s.within1 / s.n).padStart(6)}  n=${s.n}`);
}
console.log(`ALL exact ${fmtPct(m.agreement)} [95% CI ${fmtPct(m.ci[0])}–${fmtPct(m.ci[1])}] · KZ ${fmtPct(m.kzAgreement)} · total MAE ${m.totalMAE?.toFixed(2) ?? "—"}`);
console.log(`Gross errors: TP ${m.gross.tp} FP ${m.gross.fp} FN ${m.gross.fn} · invalid output ${fmtPct(m.invalidRate)} · failed ${fmtPct(m.failRate)}`);
console.log(`Cost ${fmtUsd(m.costPerDialogue)} per dialogue · latency p50 ${m.latencyP50 ? (m.latencyP50 / 1000).toFixed(1) : "—"} s, p95 ${m.latencyP95 ? (m.latencyP95 / 1000).toFixed(1) : "—"} s`);
for (const p of preds.filter((p) => p.error)) console.log(`ERROR ${p.id}: ${p.error}`);
