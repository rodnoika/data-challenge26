// Builds the files the organisers collect from the repository:
//
//   npm run results -- --set dev --data data/dev.json        # results/dev/results.json, 60 chats + 5 calls
//   npm run results -- --set prod --group <group_id>         # results/prod/results.json, 10 control chats
//   npm run results -- --set prod --data <file.json>         # the same, from a file
//   npm run results -- --set prod --validate                 # checks an existing file, no model calls
//
// options: --out <file> --team <name> --model provider/model --samples N --reasoning medium --concurrency 4
//          --ids a,b (a subset, for a dry run; skips the record count check)
// Set CQA_TEAM_NAME or pass --team. Failed dialogues get one more try, then status "error".
import "./env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { PROMPT_VERSION } from "../src/core/prompt";
import { SCHEMA_VERSION, submissionModel, toResult, validateSubmission, type Submission } from "../src/core/submission";
import type { Dialogue } from "../src/core/types";
import { defaultModel } from "../src/server/registry";
import { sameModel, voterLabel } from "../src/server/evaluator";
import type { Reasoning } from "../src/server/providers";
import { normaliseRecords, organiserUrl } from "../src/server/service";
import { fmtUsd, loadDialogues, parseArgs, parseVoter, runCandidate } from "./lib";

const EXPECTED: Record<string, number> = { dev: 65, prod: 10 };

const a = parseArgs();
const set = a.set;
if (set !== "dev" && set !== "prod") {
  console.error("Usage: npm run results -- --set dev|prod (--data <file> | --group <id> | --validate)");
  process.exit(1);
}
const out = a.out ?? `results/${set}/results.json`;

async function loadSource(): Promise<Dialogue[] | null> {
  if (a.data) return loadDialogues(a.data);
  if (!a.group) return null;
  const res = await fetch(organiserUrl(a.group), { cache: "no-store" });
  if (!res.ok) throw new Error(`Organiser API ${res.status}`);
  const body = (await res.json()) as { isSuccess?: boolean; error?: string };
  if (body?.isSuccess === false) throw new Error(`Organiser API error: ${body.error || "isSuccess=false"}`);
  // The payload holds signed links, so the copy stays in tmp/, outside git.
  mkdirSync("tmp/results", { recursive: true });
  writeFileSync(`tmp/results/${set}-source.json`, JSON.stringify(body));
  return normaliseRecords(body);
}

function report(sub: Submission, source: Dialogue[] | null, subset: boolean): boolean {
  const problems = validateSubmission(sub, {
    expectedCount: subset ? undefined : EXPECTED[set],
    source: source && !subset ? new Map(source.map((d) => [d.conversation_id, d.transcript.length])) : undefined,
  });
  const ok = sub.results.filter((r) => r.status === "ok").length;
  console.log(`${out}: ${sub.results.length} records, ok ${ok}, error ${sub.results.length - ok} · team ${sub.team_name} · ${sub.model.mode} ${sub.model.name}`);
  for (const r of sub.results.filter((x) => x.status === "error")) console.log(`  ERROR ${r.conversation_id}: ${r.error}`);
  for (const p of problems) console.log(`  PROBLEM ${p}`);
  console.log(problems.length ? `NOT READY: ${problems.length} problem(s).` : "Format check passed. Commit and push before the stop-code.");
  return !problems.length;
}

const source = await loadSource();

if (a.validate) {
  if (!existsSync(out)) throw new Error(`${out} not found`);
  const raw = readFileSync(out, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) console.log("  PROBLEM file starts with a BOM");
  process.exit(report(JSON.parse(raw), source, false) ? 0 : 1);
}

if (!source) {
  console.error("Pass --data <file> or --group <id>.");
  process.exit(1);
}
const team = a.team ?? process.env.CQA_TEAM_NAME;
if (!team?.trim()) {
  console.error("Pass --team <name> or set CQA_TEAM_NAME.");
  process.exit(1);
}

const def = defaultModel();
const voter = a.model ? parseVoter(a.model) : { provider: def.provider, model: def.model };
const voters = sameModel(voter.provider, voter.model, Number(a.samples ?? (def as { samples?: number }).samples ?? 1));
const reasoning = (a.reasoning ?? "medium") as Reasoning;
const concurrency = Number(a.concurrency ?? 4);
const ids = a.ids ? new Set(a.ids.split(",")) : null;
const dialogues = ids ? source.filter((d) => ids.has(d.conversation_id)) : source;
const unique = new Set(dialogues.map((d) => d.conversation_id));
if (unique.size !== dialogues.length) throw new Error("The source repeats a conversation_id.");

console.log(`Evaluating ${dialogues.length} dialogues · ${voterLabel(voters).label} ×${voters.length} · prompt ${PROMPT_VERSION} · reasoning ${reasoning}`);
const t0 = Date.now();
const first = await runCandidate(dialogues, DEFAULT_CHECKLIST, voters, reasoning, concurrency);
const failed = first.filter((p) => p.error).map((p) => p.id);
const retried = failed.length ? await runCandidate(dialogues.filter((d) => failed.includes(d.conversation_id)), DEFAULT_CHECKLIST, voters, reasoning, concurrency, "retry ") : [];
const preds = first.map((p) => retried.find((r) => r.id === p.id) ?? p);
const byId = new Map(preds.map((p) => [p.id, p]));

const submission: Submission = {
  schema_version: SCHEMA_VERSION,
  team_name: team.trim(),
  model: submissionModel(voters),
  // Source order, so the file reads like the organisers' set.
  results: dialogues.map((d) => {
    const p = byId.get(d.conversation_id)!;
    return toResult(d.conversation_id, DEFAULT_CHECKLIST, p.judgments, p.error);
  }),
};

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(submission, null, 2) + "\n", "utf8");

// A trace of the run for the process check; runs/ stays out of git.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
mkdirSync("runs", { recursive: true });
writeFileSync(`runs/${stamp}-results-${set}.json`, JSON.stringify({ meta: { set, voters, reasoning, promptVersion: PROMPT_VERSION, split: "all" }, predictions: preds }, null, 1));

const cost = preds.reduce((s, p) => s + (p.costUsd ?? 0), 0);
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)} s · ${fmtUsd(cost)} total`);
process.exit(report(submission, source, !!ids) ? 0 : 1);
