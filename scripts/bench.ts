// Model benchmark (PLAN.md §6a): runs the IDENTICAL prompt/checklist on every shortlisted model
// and reports agreement with the hand labels, total-score error, gross-error recall, invalid
// output rate, cost per dialogue and latency. Writes runs/* (details) and benchmarks/* (summary).
//
//   npm run bench -- --smoke                       # 3 dialogues per candidate: adapter liveness, no labels needed
//   npm run bench -- --split train                 # default shortlist (non-optional registry entries)
//   npm run bench -- --split test --with-optional --n3 "openai/gpt-6.1-sol,gemini/gemini-4-argon" \
//                    --ensemble "anthropic/claude-opus-5-5,openai/gpt-6.1-sol,gemini/gemini-4-argon"
//   options: --models "p/m,p/m" (explicit list) --tiers frontier,cheap --samples 1 --reasoning medium
//            --concurrency 4 --cap 0.15 --yes (skip the >$5 confirmation) --data --labels
import "./env";
import { createInterface } from "node:readline/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { PROMPT_VERSION } from "../src/core/prompt";
import { computeMetrics, decide, type CandidateMetrics } from "../src/core/benchmark";
import { hasKey, loadRegistry, findModel } from "../src/server/registry";
import { sameModel, voterLabel, type Voter } from "../src/server/evaluator";
import type { Checklist } from "../src/core/types";
import type { Reasoning } from "../src/server/providers";
import { selectSplit } from "../src/core/split";
import { detailRows, fmtPct, fmtUsd, hideTestRows, loadDialogues, loadTestIds, parseArgs, parseVoter, projectCost, readLabels, runCandidate, writeRunFiles } from "./lib";
import { readFileSync } from "node:fs";

const a = parseArgs();
const cl: Checklist = a.checklist ? JSON.parse(readFileSync(a.checklist, "utf8")) : DEFAULT_CHECKLIST;
const reasoning = (a.reasoning ?? "medium") as Reasoning;
const samples = Number(a.samples ?? 1);
const concurrency = Number(a.concurrency ?? 4);
const cap = Number(a.cap ?? 0.15);
const all = loadDialogues(a.data ?? "data/dev.json");
const labels = readLabels(a.labels ?? "data/labels/dev-labels.csv", cl);
const reg = loadRegistry();
const which = a.split ?? "train";
const testIds = loadTestIds(a["split-file"]);

/* ---------- candidates ---------- */
type Cand = { voters: Voter[]; tier: string; label: string };
const cands: Cand[] = [];
const add = (voters: Voter[], tier: string) => {
  const base = voterLabel(voters).label;
  const label = voters.length > 1 && new Set(voters.map((v) => `${v.provider}/${v.model}`)).size === 1 ? `${base} ×${voters.length}` : base;
  if (!cands.some((c) => c.label === label)) cands.push({ voters, tier, label });
};
if (a.models) {
  for (const s of a.models.split(",")) {
    const v = parseVoter(s.trim());
    add(sameModel(v.provider, v.model, samples), findModel(v.provider, v.model)?.tier ?? "?");
  }
} else {
  const tiers = a.tiers ? new Set(a.tiers.split(",")) : null;
  for (const m of reg.models) {
    if (m.optional && !a["with-optional"]) continue;
    if (tiers && !tiers.has(m.tier)) continue;
    add(sameModel(m.provider, m.model, samples), m.tier);
  }
}
if (a.n3) for (const s of a.n3.split(",")) {
  const v = parseVoter(s.trim());
  add(sameModel(v.provider, v.model, 3), findModel(v.provider, v.model)?.tier ?? "?");
}
if (a.ensemble) add(a.ensemble.split(",").map((s) => parseVoter(s.trim())), "ensemble");

const ollamaUp = await fetch(`${process.env.OLLAMA_URL ?? "http://localhost:11434"}/api/tags`, { signal: AbortSignal.timeout(1500) })
  .then((r) => r.ok)
  .catch(() => false);
const available = (p: string) => (p === "ollama" ? ollamaUp : hasKey(p as any));
const skipped = cands.filter((c) => c.voters.some((v) => !available(v.provider)));
const run = cands.filter((c) => !skipped.includes(c));

/* ---------- dialogues ---------- */
let dialogues = all;
const smoke = a.smoke === "true";
if (smoke) {
  // one RU chat, one KZ chat, one call: covers languages + the long ASR format
  const pick = (re: RegExp) => all.find((d) => re.test(d.conversation_id));
  dialogues = [pick(/-ru-0/), pick(/-kz-0/), all.find((d) => /voice/.test(d.channel))].filter(Boolean) as typeof all;
} else {
  if (!labels.size) {
    console.error("No labels found in data/labels/dev-labels.csv. Fill labels first, or use --smoke to only test the adapters.");
    process.exit(1);
  }
  const ids = selectSplit(all.map((d) => d.conversation_id), which, testIds).filter((id) => labels.has(id));
  dialogues = all.filter((d) => ids.includes(d.conversation_id));
}

console.log(`Prompt ${PROMPT_VERSION} · checklist ${cl.id} v${cl.version} · reasoning ${reasoning} · ${dialogues.length} dialogues${smoke ? " (smoke)" : ` (split ${which}, ${labels.size} labelled)`}`);
for (const s of skipped) console.log(`  skip ${s.label}: ${s.voters.some((v) => v.provider === "ollama") && !ollamaUp ? "Ollama is not running" : "no API key"}`);
if (!run.length) {
  console.error("No candidate can run: add API keys to .env.local and/or start Ollama.");
  process.exit(1);
}

/* ---------- projected cost + confirmation ---------- */
let projected = 0;
for (const c of run) {
  const p = projectCost(dialogues, cl, c.voters);
  console.log(`  ${c.label.padEnd(58)} projected ≤ ${p === null ? "unknown (no checked price)" : `$${p.toFixed(2)}`}`);
  projected += p ?? 0;
}
console.log(`Projected total ≤ $${projected.toFixed(2)} (upper bound: no caching, 3k output tokens per vote)`);
if (projected > 5 && a.yes !== "true") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question("Above $5. Continue? [y/N] ");
  rl.close();
  if (!/^y/i.test(ans)) process.exit(0);
}

/* ---------- run ---------- */
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const rows: (CandidateMetrics & { voters: Voter[] })[] = [];
for (const c of run) {
  const preds = await runCandidate(dialogues, cl, c.voters, reasoning, concurrency);
  const id = voterLabel(c.voters);
  const m = computeMetrics(cl, labels, preds, { candidate: c.label, provider: id.provider, model: id.model, tier: c.tier, samples: c.voters.length });
  rows.push({ ...m, voters: c.voters });
  writeRunFiles(
    `runs/${stamp}-${c.label.replace(/[^a-z0-9.+-]/gi, "_")}`,
    { meta: { candidate: c.label, voters: c.voters, reasoning, promptVersion: PROMPT_VERSION, split: smoke ? "smoke" : which }, metrics: m, predictions: preds },
    hideTestRows(detailRows(cl, labels, preds, c.label), testIds, a["show-test"] === "true"),
  );
  for (const p of preds.filter((p) => p.error)) console.log(`    ERROR ${p.id}: ${(p.error ?? "").slice(0, 300)}`);
}

/* ---------- report ---------- */
const sorted = [...rows].sort((x, y) => y.agreement - x.agreement);
console.log(`\n${"candidate".padEnd(58)} agree   95% CI          KZ     MAE   gross  invalid fail  $/dlg    p50`);
for (const r of sorted) {
  console.log(
    `${r.candidate.padEnd(58)} ${fmtPct(r.agreement).padStart(6)} [${fmtPct(r.ci[0])}–${fmtPct(r.ci[1])}] ${fmtPct(r.kzAgreement).padStart(6)} ${r.totalMAE === null ? "   —" : r.totalMAE.toFixed(1).padStart(5)}  ${r.gross.recall === null ? "  —" : fmtPct(r.gross.recall).padStart(5)} ${fmtPct(r.invalidRate).padStart(6)} ${fmtPct(r.failRate).padStart(5)} ${fmtUsd(r.costPerDialogue)} ${r.latencyP50 === null ? "—" : `${(r.latencyP50 / 1000).toFixed(1)}s`}`,
  );
}
const decision = smoke ? null : decide(rows, cap);
if (decision) {
  console.log(`\nDecision (${decision.rule}):\n  winner: ${decision.winner ?? "none passes the gates"}\n  fallback (other vendor): ${decision.fallback ?? "—"}\n  tied with leader: ${decision.tied.join(", ") || "—"}`);
  for (const e of decision.excluded) console.log(`  excluded ${e.candidate}: ${e.reason}`);
}

mkdirSync("benchmarks", { recursive: true });
const out = `benchmarks/${stamp}-${smoke ? "smoke" : which}.json`;
writeFileSync(
  out,
  JSON.stringify(
    {
      meta: {
        createdAt: new Date().toISOString(),
        split: smoke ? "smoke" : which,
        dialogues: dialogues.length,
        labelled: labels.size,
        promptVersion: PROMPT_VERSION,
        checklist: `${cl.id} v${cl.version}`,
        reasoning,
        costCap: cap,
        prices: Object.fromEntries(reg.models.map((m) => [`${m.provider}/${m.model}`, { price: m.price, checkedAt: m.checkedAt, source: m.priceSource }])),
        skipped: skipped.map((s) => s.label),
      },
      candidates: rows,
      decision,
    },
    null,
    1,
  ),
);
console.log(`\nSummary: ${out}  (details in runs/${stamp}-*)${decision?.winner ? `\nApply with: npm run compare -- ${out} --apply` : ""}`);
