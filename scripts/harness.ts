// Accuracy harness: runs the real evaluator on labelled dialogues and reports agreement.
//
//   npm run harness -- --provider anthropic --model claude-opus-5-5 --samples 1 [--ids a,b] [--split tune|holdout|all]
//   npm run harness -- --from runs/<file>.json     (re-score a previous run against current labels, no API calls)
//
// Output: runs/<timestamp>-<model>.json (+ .csv per criterion) for analysis in pandas.
import "./env";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { evaluateDialogue } from "../src/server/evaluator";
import { normaliseRecords } from "../src/server/service";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { parseAnswer, score } from "../src/core/scoring";
import type { Answer, Checklist, Dialogue, Judgment } from "../src/core/types";
import type { ProviderId } from "../src/server/providers";

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "true" : arr[i + 1]]);
    return acc;
  }, []),
);
const dataFile = args.data ?? "data/dev.json";
const labelsFile = args.labels ?? "data/labels/dev-labels.csv";
const checklist: Checklist = args.checklist ? JSON.parse(readFileSync(args.checklist, "utf8")) : DEFAULT_CHECKLIST;
const provider = (args.provider ?? "anthropic") as ProviderId;
const model = args.model ?? "claude-opus-5-5";
const samples = Number(args.samples ?? 1);
const effort = (args.effort ?? "medium") as any;
const concurrency = Number(args.concurrency ?? 5);

/* ---------- labels ---------- */
function readLabels(): Map<string, Record<string, Answer>> {
  const m = new Map<string, Record<string, Answer>>();
  if (!existsSync(labelsFile)) return m;
  const [head, ...lines] = readFileSync(labelsFile, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",").map((s) => s.trim());
  for (const line of lines) {
    const cells = line.split(",").map((s) => s.trim());
    const id = cells[cols.indexOf("conversation_id")];
    const rec: Record<string, Answer> = {};
    for (const c of checklist.criteria) {
      const i = cols.indexOf(c.id);
      if (i < 0 || !cells[i]) continue;
      const a = parseAnswer(c, cells[i]);
      if (a !== null) rec[c.id] = a;
    }
    if (Object.keys(rec).length) m.set(id, rec);
  }
  return m;
}
const labels = readLabels();

/* ---------- split: deterministic hold-out (every 3rd labelled id per language) ---------- */
function split(ids: string[], which: string) {
  if (which === "all") return ids;
  const byLang = new Map<string, string[]>();
  for (const id of ids) {
    const k = id.split("-").slice(0, 2).join("-");
    byLang.set(k, [...(byLang.get(k) ?? []), id]);
  }
  const hold = new Set<string>();
  for (const list of byLang.values()) list.sort().forEach((id, i) => i % 3 === 2 && hold.add(id));
  return ids.filter((id) => (which === "holdout" ? hold.has(id) : !hold.has(id)));
}

/* ---------- run or load ---------- */
type Pred = { id: string; judgments: Judgment[]; total: number | null; cost: number | null; latencyMs: number; error?: string };
let preds: Pred[];
let meta: Record<string, unknown>;

if (args.from) {
  const prev = JSON.parse(readFileSync(args.from, "utf8"));
  preds = prev.predictions;
  meta = { ...prev.meta, rescoredAt: new Date().toISOString() };
} else {
  const all: Dialogue[] = normaliseRecords(JSON.parse(readFileSync(dataFile, "utf8")));
  let ids = args.ids ? args.ids.split(",") : all.map((d) => d.conversation_id);
  if (!args.ids && labels.size) ids = split(ids.filter((id) => labels.has(id)), args.split ?? "all");
  const todo = all.filter((d) => ids.includes(d.conversation_id));
  console.log(`Evaluating ${todo.length} dialogues with ${provider}/${model} x${samples} (effort ${effort})...`);
  preds = [];
  const queue = [...todo];
  let n = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const d = queue.shift()!;
        try {
          const out = await evaluateDialogue(d, checklist, { provider, model, samples, effort });
          preds.push({ id: d.conversation_id, judgments: out.judgments, total: out.score.total, cost: out.costUsd, latencyMs: out.latencyMs });
        } catch (e) {
          preds.push({ id: d.conversation_id, judgments: [], total: null, cost: null, latencyMs: 0, error: String(e) });
        }
        process.stdout.write(`\r${++n}/${todo.length}`);
      }
    }),
  );
  process.stdout.write("\n");
  meta = { provider, model, samples, effort, checklist: checklist.id, at: new Date().toISOString() };
}

/* ---------- metrics ---------- */
const rows: Record<string, unknown>[] = [];
const per: Record<string, { n: number; exact: number; within1: number; confusion: Record<string, number> }> = {};
const totalsErr: number[] = [];
const byGroup: Record<string, { n: number; exact: number }> = {};
let gross = { tp: 0, fp: 0, fn: 0 };

for (const p of preds.sort((a, b) => a.id.localeCompare(b.id))) {
  const gold = labels.get(p.id);
  const pm = new Map(p.judgments.map((j) => [j.criterionId, j]));
  if (gold) {
    const goldJ: Judgment[] = Object.entries(gold).map(([k, v]) => ({ criterionId: k, answer: v, explanation: "", evidenceTurnIds: [], checkedSpan: null, naReason: null, confidence: "high", votes: [v] }));
    const goldTotal = score(checklist, goldJ).total;
    if (goldTotal !== null && p.total !== null && Object.keys(gold).length === checklist.criteria.length) totalsErr.push(Math.abs(goldTotal - p.total));
    const grp = p.id.split("-").slice(0, 2).join("-");
    for (const c of checklist.criteria) {
      if (!(c.id in gold)) continue;
      const g = gold[c.id];
      const pr = pm.get(c.id)?.answer;
      const st = (per[c.id] ??= { n: 0, exact: 0, within1: 0, confusion: {} });
      const bg = (byGroup[grp] ??= { n: 0, exact: 0 });
      st.n++;
      bg.n++;
      const exact = pr !== undefined && String(pr) === String(g);
      if (exact) (st.exact++, bg.exact++);
      if (c.answerType === "scale" && typeof g === "number" && typeof pr === "number") {
        const steps = (c.steps ?? []).map((s) => s.value).sort((a, b) => a - b);
        if (Math.abs(steps.indexOf(g) - steps.indexOf(pr)) <= 1) st.within1++;
      } else if (exact) st.within1++;
      const key = `${g}->${pr ?? "missing"}`;
      st.confusion[key] = (st.confusion[key] ?? 0) + 1;
      if (c.isFlag) {
        if (g === "yes" && pr === "yes") gross.tp++;
        else if (g !== "yes" && pr === "yes") gross.fp++;
        else if (g === "yes" && pr !== "yes") gross.fn++;
      }
      rows.push({ id: p.id, criterion: c.id, gold: g, pred: pr ?? "", exact: exact ? 1 : 0, confidence: pm.get(c.id)?.confidence ?? "", explanation: pm.get(c.id)?.explanation ?? "" });
    }
  }
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");
console.log(`\nLabels: ${labels.size} dialogues · predictions: ${preds.length} · errors: ${preds.filter((p) => p.error).length}`);
for (const c of checklist.criteria) {
  const s = per[c.id];
  if (!s) continue;
  const conf = Object.entries(s.confusion).filter(([k]) => k.split("->")[0] !== k.split("->")[1]).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(`${c.id} ${c.title.padEnd(42).slice(0, 42)} exact ${pct(s.exact, s.n).padStart(6)} ±1 ${pct(s.within1, s.n).padStart(6)}  n=${s.n}  ${conf}`);
}
const allN = Object.values(per).reduce((a, s) => a + s.n, 0);
const allE = Object.values(per).reduce((a, s) => a + s.exact, 0);
console.log(`ALL criteria exact ${pct(allE, allN)} · total MAE ${totalsErr.length ? (totalsErr.reduce((a, b) => a + b, 0) / totalsErr.length).toFixed(2) : "—"} (n=${totalsErr.length})`);
console.log(`Gross errors: TP ${gross.tp} FP ${gross.fp} FN ${gross.fn}`);
for (const [g, s] of Object.entries(byGroup)) console.log(`  ${g}: exact ${pct(s.exact, s.n)}`);
const costs = preds.map((p) => p.cost).filter((x): x is number => x !== null);
if (costs.length) console.log(`Cost: mean $${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4)} per evaluation · total $${costs.reduce((a, b) => a + b, 0).toFixed(3)}`);
const lat = preds.filter((p) => p.latencyMs).map((p) => p.latencyMs);
if (lat.length) console.log(`Latency: mean ${(lat.reduce((a, b) => a + b, 0) / lat.length / 1000).toFixed(1)} s`);
for (const p of preds.filter((p) => p.error)) console.log(`ERROR ${p.id}: ${p.error}`);

mkdirSync("runs", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const base = args.from ? args.from.replace(/\.json$/, "-rescored") : `runs/${stamp}-${String(meta.model).replace(/[^a-z0-9.-]/gi, "_")}`;
writeFileSync(`${base}.json`, JSON.stringify({ meta, predictions: preds, metrics: { per, totalsMAE: totalsErr, gross, byGroup } }, null, 1));
const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
if (rows.length) writeFileSync(`${base}.csv`, [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).map(esc).join(","))].join("\n"));
console.log(`Saved ${base}.json${rows.length ? ` and ${base}.csv` : ""}`);
