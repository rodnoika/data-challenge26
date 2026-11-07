import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { evaluateDialogue, voterLabel, type Voter } from "../src/server/evaluator";
import { normaliseRecords } from "../src/server/service";
import { findModel } from "../src/server/registry";
import { buildSystemPrompt, buildUserPrompt } from "../src/core/prompt";
import { computeFacts } from "../src/core/facts";
import { parseAnswer } from "../src/core/scoring";
import type { Labels, Prediction } from "../src/core/benchmark";
import type { Answer, Checklist, Dialogue, Judgment } from "../src/core/types";
import type { Reasoning } from "../src/server/providers";

export function parseArgs(argv = process.argv.slice(2)): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    out[argv[i].slice(2)] = next === undefined || next.startsWith("--") ? "true" : (i++, next);
  }
  return out;
}

export function loadDialogues(file: string): Dialogue[] {
  if (!existsSync(file)) throw new Error(`${file} not found: run \`npm run fetch:dataset -- DEV\` first`);
  return normaliseRecords(JSON.parse(readFileSync(file, "utf8")));
}

export function readLabels(file: string, cl: Checklist): Labels {
  const m: Labels = new Map();
  if (!existsSync(file)) return m;
  const [head, ...lines] = readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",").map((s) => s.trim());
  for (const line of lines) {
    const cells = line.split(",").map((s) => s.trim());
    const id = cells[cols.indexOf("conversation_id")];
    const rec: Record<string, Answer> = {};
    for (const c of cl.criteria) {
      const i = cols.indexOf(c.id);
      if (i < 0 || !cells[i]) continue;
      const a = parseAnswer(c, cells[i]);
      if (a !== null) rec[c.id] = a;
    }
    if (Object.keys(rec).length) m.set(id, rec);
  }
  return m;
}

/** Deterministic hold-out: every 3rd id (sorted) within each channel+language group. */
export function split(ids: string[], which: string): string[] {
  if (which === "all") return ids;
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const k = id.split("-").slice(0, 2).join("-");
    groups.set(k, [...(groups.get(k) ?? []), id]);
  }
  const hold = new Set<string>();
  for (const list of groups.values()) [...list].sort().forEach((id, i) => i % 3 === 2 && hold.add(id));
  return ids.filter((id) => (which === "holdout" ? hold.has(id) : !hold.has(id)));
}

/** Parse "provider/model" (model may contain "/" or ":"). */
export function parseVoter(s: string): Voter {
  const i = s.indexOf("/");
  if (i < 0) throw new Error(`Expected provider/model, got "${s}"`);
  return { provider: s.slice(0, i) as Voter["provider"], model: s.slice(i + 1) };
}

/** Rough upper-bound projection (no caching, ~3 chars/token, 3000 output tokens incl. reasoning per vote). */
export function projectCost(dialogues: Dialogue[], cl: Checklist, voters: Voter[]): number | null {
  const sys = buildSystemPrompt(cl).length;
  let total = 0;
  for (const v of voters) {
    const m = findModel(v.provider, v.model);
    if (!m?.price) return null;
    for (const d of dialogues) {
      const inTok = (sys + buildUserPrompt(d, computeFacts(d, cl.waitThresholdSec)).length) / 3;
      total += (inTok * m.price.in + 3000 * m.price.out) / 1e6;
    }
  }
  return total;
}

export interface FullPrediction extends Prediction {
  details: Judgment[];
}

export async function runCandidate(
  dialogues: Dialogue[],
  cl: Checklist,
  voters: Voter[],
  reasoning: Reasoning,
  concurrency: number,
  tag = "",
): Promise<FullPrediction[]> {
  const preds: FullPrediction[] = [];
  const queue = [...dialogues];
  let n = 0;
  const label = voterLabel(voters).label + (voters.length > 1 && new Set(voters.map((v) => v.model)).size === 1 ? ` ×${voters.length}` : "");
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const d = queue.shift()!;
        try {
          const out = await evaluateDialogue(d, cl, { voters, reasoning });
          preds.push({
            id: d.conversation_id,
            judgments: out.judgments,
            details: out.judgments,
            total: out.score.total,
            costUsd: out.costUsd,
            latencyMs: out.latencyMs,
            votes: out.votes.length,
            invalidVotes: out.votes.filter((v) => v.invalidFirst || !v.ok).length,
          });
        } catch (e) {
          preds.push({ id: d.conversation_id, judgments: [], details: [], total: null, costUsd: null, latencyMs: 0, votes: voters.length, invalidVotes: voters.length, error: e instanceof Error ? e.message : String(e) });
        }
        process.stdout.write(`\r  ${tag}${label}: ${++n}/${dialogues.length}   `);
      }
    }),
  );
  process.stdout.write("\n");
  return preds.sort((a, b) => a.id.localeCompare(b.id));
}

export function writeRunFiles(base: string, payload: unknown, rows: Record<string, unknown>[]) {
  mkdirSync(base.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  writeFileSync(`${base}.json`, JSON.stringify(payload, null, 1));
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  if (rows.length) writeFileSync(`${base}.csv`, [Object.keys(rows[0]).join(","), ...rows.map((r) => Object.values(r).map(esc).join(","))].join("\n"));
}

export function detailRows(cl: Checklist, labels: Labels, preds: FullPrediction[], candidate: string) {
  const rows: Record<string, unknown>[] = [];
  for (const p of preds) {
    const gold = labels.get(p.id) ?? {};
    for (const c of cl.criteria) {
      const j = p.details.find((x) => x.criterionId === c.id);
      rows.push({
        candidate,
        id: p.id,
        criterion: c.id,
        gold: gold[c.id] ?? "",
        pred: j?.answer ?? "",
        exact: c.id in gold && j ? (String(j.answer) === String(gold[c.id]) ? 1 : 0) : "",
        confidence: j?.confidence ?? "",
        votes: j?.votes.join("|") ?? "",
        explanation: j?.explanation ?? "",
        error: p.error ?? "",
      });
    }
  }
  return rows;
}

export const fmtPct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(1)}%`);
export const fmtUsd = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `$${x.toFixed(4)}`);
