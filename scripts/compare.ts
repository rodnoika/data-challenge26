// Print one or more benchmark summaries side by side and apply the decision rule.
//   npm run compare                              # latest file in benchmarks/
//   npm run compare -- benchmarks/x.json --cap 0.15
//   npm run compare -- benchmarks/x.json --apply # write the winner/fallback into config/models.json
import "./env";
import { readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { decide, type CandidateMetrics } from "../src/core/benchmark";
import { REGISTRY_PATH } from "../src/server/registry";
import type { Voter } from "../src/server/evaluator";
import { fmtPct, fmtUsd, parseArgs } from "./lib";

const a = parseArgs();
const files = process.argv.slice(2).filter((x) => x.endsWith(".json"));
const target =
  files[0] ??
  readdirSync("benchmarks")
    .filter((f) => f.endsWith(".json") && !f.includes("smoke"))
    .sort()
    .map((f) => `benchmarks/${f}`)
    .at(-1);
if (!target) throw new Error("No benchmark summaries in benchmarks/");
const b = JSON.parse(readFileSync(target, "utf8"));
const rows: (CandidateMetrics & { voters: Voter[] })[] = b.candidates;
const cap = Number(a.cap ?? b.meta.costCap ?? 0.15);
const d = decide(rows, cap);

console.log(`${target} · split ${b.meta.split} · ${b.meta.dialogues} dialogues · prompt ${b.meta.promptVersion} · ${b.meta.checklist}`);
console.log(`${"candidate".padEnd(58)} agree   95% CI          KZ     MAE   gross  invalid  $/dlg    p50`);
for (const r of [...rows].sort((x, y) => y.agreement - x.agreement)) {
  const mark = r.candidate === d.winner ? "★" : r.candidate === d.fallback ? "◇" : " ";
  console.log(
    `${mark}${r.candidate.padEnd(57)} ${fmtPct(r.agreement).padStart(6)} [${fmtPct(r.ci[0])}–${fmtPct(r.ci[1])}] ${fmtPct(r.kzAgreement).padStart(6)} ${r.totalMAE === null ? "   —" : r.totalMAE.toFixed(1).padStart(5)}  ${r.gross.recall === null ? "  —" : fmtPct(r.gross.recall).padStart(5)} ${fmtPct(r.invalidRate).padStart(6)}  ${fmtUsd(r.costPerDialogue)} ${r.latencyP50 === null ? "—" : `${(r.latencyP50 / 1000).toFixed(1)}s`}`,
  );
}
console.log(`\n${d.rule}\n★ winner: ${d.winner ?? "none"}\n◇ fallback (other vendor): ${d.fallback ?? "—"}`);
for (const e of d.excluded) console.log(`  excluded ${e.candidate}: ${e.reason}`);

if (a.apply === "true") {
  if (b.meta.split === "smoke") throw new Error("Refusing to apply a smoke run");
  if (!d.winner) throw new Error("No winner to apply");
  const toDefault = (label: string | null) => {
    if (!label) return null;
    const r = rows.find((x) => x.candidate === label)!;
    const uniq = new Set(r.voters.map((v) => `${v.provider}/${v.model}`));
    const chosenBy = `benchmark ${target} (${b.meta.split}, ${b.meta.dialogues} dialogues, agreement ${fmtPct(r.agreement)})`;
    return uniq.size === 1
      ? { provider: r.voters[0].provider, model: r.voters[0].model, samples: r.voters.length, chosenBy }
      : { provider: r.voters[0].provider, model: r.voters[0].model, ensemble: r.voters, chosenBy };
  };
  copyFileSync(REGISTRY_PATH, `${REGISTRY_PATH}.bak`);
  const reg = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  reg.default = toDefault(d.winner);
  reg.fallback = toDefault(d.fallback);
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n");
  console.log(`\nApplied to config/models.json (backup: models.json.bak). In the UI, "Сбросить к модели по умолчанию" drops any manual choice.`);
}
