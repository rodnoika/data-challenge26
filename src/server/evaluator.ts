import { aggregate } from "@/core/aggregate";
import { computeFacts, type Facts } from "@/core/facts";
import { buildOutputSchema, buildSystemPrompt, buildUserPrompt, parseJudgments, PROMPT_VERSION } from "@/core/prompt";
import { score } from "@/core/scoring";
import type { Checklist, Dialogue, Judgment, ScoreResult, Usage } from "@/core/types";
import { costUsd, getProvider, type ProviderId } from "./providers";

export interface EvalOptions {
  provider: ProviderId;
  model: string;
  samples: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface EvalOutput {
  judgments: Judgment[];
  score: ScoreResult;
  facts: Facts;
  usage: Usage;
  costUsd: number | null;
  latencyMs: number;
  model: string;
  promptVersion: string;
  samplesOk: number;
  raw: unknown[];
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

/**
 * Evaluate one dialogue with one checklist. The model only produces per-criterion
 * judgments; points, redistribution and totals are computed in code.
 */
export async function evaluateDialogue(d: Dialogue, cl: Checklist, opts: EvalOptions): Promise<EvalOutput> {
  const t0 = Date.now();
  const facts = computeFacts(d, cl.waitThresholdSec);
  const system = buildSystemPrompt(cl);
  const user = buildUserPrompt(d, facts);
  const schema = buildOutputSchema(cl);
  const provider = getProvider(opts.provider);
  const n = Math.max(1, Math.min(7, opts.samples));

  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let modelUsed = opts.model;
  const raws: unknown[] = [];

  const runOne = async (): Promise<Judgment[]> => {
    // one retry for transient parse/validation failures
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await provider.judge({ system, user, schema, model: opts.model, effort: opts.effort });
        usage = addUsage(usage, res.usage);
        modelUsed = res.model || modelUsed;
        raws.push(res.json);
        const { judgments, problems } = parseJudgments(cl, res.json, d.transcript.length);
        if (problems.length && attempt === 0) throw new Error(`Invalid output: ${problems.join("; ")}`);
        return judgments;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  };

  // The first call warms the prompt cache for the shared system prefix; the rest run in parallel.
  const results: Judgment[][] = [];
  const errors: unknown[] = [];
  try {
    results.push(await runOne());
  } catch (e) {
    errors.push(e);
  }
  const rest = await Promise.allSettled(Array.from({ length: n - 1 }, () => runOne()));
  for (const r of rest) (r.status === "fulfilled" ? results.push(r.value) : errors.push(r.reason));
  if (!results.length) throw errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));

  const judgments = results.length === 1 ? results[0] : aggregate(cl, results);
  return {
    judgments,
    score: score(cl, judgments),
    facts,
    usage,
    costUsd: costUsd(opts.model, usage),
    latencyMs: Date.now() - t0,
    model: modelUsed,
    promptVersion: PROMPT_VERSION,
    samplesOk: results.length,
    raw: raws,
  };
}
