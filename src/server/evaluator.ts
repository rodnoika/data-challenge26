import { aggregate } from "@/core/aggregate";
import { computeFacts, type Facts } from "@/core/facts";
import { buildOutputSchema, buildSystemPrompt, buildUserPrompt, parseJudgments, PROMPT_VERSION } from "@/core/prompt";
import { score } from "@/core/scoring";
import type { Checklist, Dialogue, Judgment, ScoreResult, Usage } from "@/core/types";
import { getProvider, type Reasoning } from "./providers";
import { costUsd, type ProviderId } from "./registry";

export interface Voter {
  provider: ProviderId;
  model: string;
}

export interface EvalOptions {
  /** One entry per vote. N votes of one model = the same voter repeated; an ensemble = different voters. */
  voters: Voter[];
  reasoning?: Reasoning;
}

export interface VoteLog {
  provider: ProviderId;
  model: string;
  ok: boolean;
  /** First response failed schema/answer validation and had to be re-asked. */
  invalidFirst: boolean;
  latencyMs: number;
  usage: Usage;
  costUsd: number | null;
  error?: string;
}

export interface EvalOutput {
  judgments: Judgment[];
  score: ScoreResult;
  facts: Facts;
  usage: Usage;
  /** Sum over votes; null if any vote's model has no checked price. */
  costUsd: number | null;
  /** Wall-clock for the whole evaluation. */
  latencyMs: number;
  /** "provider/model" or "ensemble(a,b,c)" for display and storage. */
  label: string;
  provider: string;
  model: string;
  promptVersion: string;
  reasoning: Reasoning;
  votes: VoteLog[];
  raw: unknown[];
}

const zero = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
const add = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

export function voterLabel(voters: Voter[]): { provider: string; model: string; label: string } {
  const uniq = [...new Set(voters.map((v) => `${v.provider}/${v.model}`))];
  if (uniq.length === 1) {
    const [provider, ...rest] = uniq[0].split("/");
    return { provider, model: rest.join("/"), label: uniq[0] };
  }
  return { provider: "ensemble", model: uniq.join("+"), label: `ensemble(${uniq.join(", ")})` };
}

/**
 * Evaluate one dialogue with one checklist. Identical prompt and schema for every provider.
 * The model only produces per-criterion judgments; points, redistribution and totals are code.
 */
export async function evaluateDialogue(d: Dialogue, cl: Checklist, opts: EvalOptions): Promise<EvalOutput> {
  const t0 = Date.now();
  const reasoning = opts.reasoning ?? "medium";
  const facts = computeFacts(d, cl.waitThresholdSec);
  const system = buildSystemPrompt(cl);
  const user = buildUserPrompt(d, facts);
  const schema = buildOutputSchema(cl);
  const voters = opts.voters.length ? opts.voters.slice(0, 7) : [];
  if (!voters.length) throw new Error("No voters configured");

  const raws: unknown[] = [];

  // Shared validation + exactly one re-ask, identical for every provider.
  const runVote = async (v: Voter): Promise<{ judgments: Judgment[] | null; log: VoteLog }> => {
    const provider = getProvider(v.provider);
    let usage = zero();
    let latencyMs = 0;
    let invalidFirst = false;
    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await provider.judge({ system, user, schema, model: v.model, reasoning });
        usage = add(usage, res.usage);
        latencyMs += res.latencyMs;
        raws.push({ voter: `${v.provider}/${v.model}`, attempt, json: res.json });
        const { judgments, problems } = parseJudgments(cl, res.json, d.transcript.length);
        if (problems.length) {
          if (attempt === 0) invalidFirst = true;
          lastErr = `invalid output: ${problems.join("; ")}`;
          if (attempt === 0) continue;
          if (!judgments.length) break;
        }
        return { judgments, log: { ...v, ok: true, invalidFirst, latencyMs, usage, costUsd: costUsd(v.provider, v.model, usage) } };
      } catch (e) {
        if (attempt === 0) invalidFirst = invalidFirst || /JSON/i.test(String(e));
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    return { judgments: null, log: { ...v, ok: false, invalidFirst, latencyMs, usage, costUsd: costUsd(v.provider, v.model, usage), error: lastErr } };
  };

  // First vote alone warms provider-side prompt caches; remaining votes run in parallel.
  const first = await runVote(voters[0]);
  const rest = await Promise.all(voters.slice(1).map(runVote));
  const all = [first, ...rest];
  const ok = all.filter((r) => r.judgments).map((r) => r.judgments!) as Judgment[][];
  if (!ok.length) throw new Error(all.map((r) => `${r.log.provider}/${r.log.model}: ${r.log.error}`).join(" | "));

  const judgments = ok.length === 1 ? ok[0] : aggregate(cl, ok);
  const usage = all.reduce((a, r) => add(a, r.log.usage), zero());
  const costs = all.map((r) => r.log.costUsd);
  const id = voterLabel(voters);
  return {
    judgments,
    score: score(cl, judgments),
    facts,
    usage,
    costUsd: costs.some((c) => c === null) ? null : costs.reduce<number>((a, c) => a + (c ?? 0), 0),
    latencyMs: Date.now() - t0,
    label: id.label,
    provider: id.provider,
    model: id.model,
    promptVersion: PROMPT_VERSION,
    reasoning,
    votes: all.map((r) => r.log),
    raw: raws,
  };
}

/** N votes of one model. */
export const sameModel = (provider: ProviderId, model: string, n: number): Voter[] =>
  Array.from({ length: Math.max(1, Math.min(7, n)) }, () => ({ provider, model }));
