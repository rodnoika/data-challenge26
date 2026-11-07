// Shows what a checklist change did to the criteria it did not touch. An overall figure can stay flat
// while one criterion moves, so the report is per criterion, next to the usual run-to-run noise.
//
//   npm run impact -- --base runs/<before>.json --run runs/<after>.json [--noise runs/<same prompt x3>.json]
import { readFileSync } from "node:fs";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { readLabels, parseArgs } from "./lib";
import type { Judgment } from "../src/core/types";

type Run = { meta?: { promptVersion?: string }; predictions: { id: string; judgments?: Judgment[] }[] };

const a = parseArgs();
if (!a.base || !a.run) {
  console.error("Usage: npm run impact -- --base runs/<before>.json --run runs/<after>.json [--noise runs/<x3>.json]");
  process.exit(1);
}
const load = (f: string): Run => JSON.parse(readFileSync(f, "utf8"));
const base = load(a.base);
const run = load(a.run);
const noise = a.noise ? load(a.noise) : null;
const labels = readLabels(a.labels ?? "data/labels/dev-labels.csv", DEFAULT_CHECKLIST);

const index = (r: Run) => new Map(r.predictions.map((p) => [p.id, new Map((p.judgments ?? []).map((j) => [j.criterionId, j]))]));
const before = index(base);
const after = index(run);
const noiseIdx = noise ? index(noise) : null;
const ids = [...after.keys()].filter((id) => before.has(id) && after.get(id)!.size);
const critIds = (m: Map<string, Map<string, Judgment>>) => new Set([...m.values()].flatMap((x) => [...x.keys()]));
const baseCrit = critIds(before);
const runCrit = critIds(after);
const kept = [...runCrit].filter((c) => baseCrit.has(c)).sort();
const added = [...runCrit].filter((c) => !baseCrit.has(c)).sort();
const removed = [...baseCrit].filter((c) => !runCrit.has(c)).sort();
const pct = (x: number, n: number) => (n ? `${((100 * x) / n).toFixed(1)}%` : "—");

console.log(`Chats: ${ids.length} · removed: ${removed.join(", ") || "—"} · added: ${added.join(", ") || "—"}`);
console.log("\ncriterion  changed  noise   match before -> after");
let changedTotal = 0;
let noiseDiff = 0;
let noiseN = 0;
const rows: string[] = [];
for (const c of kept) {
  let changed = 0;
  let matchBefore = 0;
  let matchAfter = 0;
  let cNoise = 0;
  let cNoiseN = 0;
  for (const id of ids) {
    const x = before.get(id)!.get(c);
    const y = after.get(id)!.get(c);
    if (!x || !y) continue;
    const gold = labels.get(id)?.[c];
    if (String(x.answer) === String(gold)) matchBefore++;
    if (String(y.answer) === String(gold)) matchAfter++;
    if (String(x.answer) !== String(y.answer)) {
      changed++;
      rows.push(`  ${id} ${c}: ${x.answer} -> ${y.answer} (label ${gold ?? "—"})`);
    }
    for (const vote of noiseIdx?.get(id)?.get(c)?.votes ?? []) {
      cNoiseN++;
      if (String(vote) !== String(x.answer)) cNoise++;
    }
  }
  changedTotal += changed;
  noiseDiff += cNoise;
  noiseN += cNoiseN;
  console.log(`${c.padEnd(10)} ${String(changed).padStart(3)}/${ids.length}  ${pct(cNoise, cNoiseN).padStart(6)}  ${matchBefore} -> ${matchAfter}`);
}
const keptN = kept.length * ids.length;
console.log(`all kept   ${String(changedTotal).padStart(3)}/${keptN} (${pct(changedTotal, keptN)})${noise ? ` · noise ${pct(noiseDiff, noiseN)}` : ""}`);
if (rows.length) console.log(`\nChanged answers:\n${rows.join("\n")}`);

for (const c of added) {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const answer = String(after.get(id)!.get(c)?.answer ?? "—");
    counts.set(answer, (counts.get(answer) ?? 0) + 1);
  }
  const dist = [...counts].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}: ${v}`).join(", ");
  console.log(`\nNew criterion ${c}: ${dist}${counts.size === 1 ? "  WARNING: one answer on every chat" : ""}`);
}
