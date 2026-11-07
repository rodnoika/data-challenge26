import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Usage } from "@/core/types";
import { extractJson } from "@/core/prompt";
import type { ProviderId } from "./registry";

export { PROVIDER_IDS, type ProviderId } from "./registry";

/**
 * Vendor-neutral judge interface. Every adapter receives the SAME system/user text and the
 * SAME JSON schema, enforces the schema with its vendor's own structured-output mechanism,
 * and returns parsed JSON + token usage + latency. Adapters only do transport (incl. retries
 * on 429/5xx); validation and the single re-ask on invalid output live in evaluator.ts.
 */
export type Reasoning = "low" | "medium" | "high";

export interface JudgeRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  model: string;
  reasoning: Reasoning;
}

export interface JudgeResponse {
  json: unknown;
  text: string;
  usage: Usage;
  latencyMs: number;
  model: string;
}

export interface LLMProvider {
  id: ProviderId;
  judge(req: JudgeRequest): Promise<JudgeResponse>;
}

const MAX_OUTPUT_TOKENS = 16000;

/** Models that rejected the reasoning control once; we stop sending it to them. */
const noReasoning = new Set<string>();
const rejectsReasoning = (e: unknown) =>
  /reasoning|thinking|effort|not supported|unsupported|unknown (field|parameter)|invalid.*(param|argument)/i.test(
    String((e as any)?.message ?? e),
  ) && [400, 422].includes(Number((e as any)?.status ?? 400));

async function withTransportRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const status = Number(e?.status ?? e?.code ?? 0);
      const transient = status === 429 || status >= 500 || /fetch failed|ECONNRESET|ETIMEDOUT|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(String(e?.message));
      if (!transient || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i + Math.random() * 500));
    }
  }
  throw last;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = Date.now();
  const r = await fn();
  return [r, Date.now() - t0];
}

/* ---------------- Anthropic: output_config.format (json_schema); reasoning -> effort ---------------- */
class AnthropicProvider implements LLMProvider {
  id = "anthropic" as const;
  private client = new Anthropic({ maxRetries: 4, timeout: 240_000 });
  async judge(req: JudgeRequest): Promise<JudgeResponse> {
    const key = `anthropic/${req.model}`;
    const call = (withReasoning: boolean) =>
      this.client.messages.create({
        model: req.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        ...(withReasoning ? { thinking: { type: "adaptive" as const } } : {}),
        output_config: {
          ...(withReasoning ? { effort: req.reasoning } : {}),
          format: { type: "json_schema", schema: req.schema },
        },
        // caching is transparent (does not change the prompt); other vendors cache automatically
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: req.user }],
      });
    const [res, latencyMs] = await timed(async () => {
      if (noReasoning.has(key)) return call(false);
      try {
        return await call(true);
      } catch (e) {
        if (!rejectsReasoning(e)) throw e;
        noReasoning.add(key);
        return call(false);
      }
    });
    if (res.stop_reason === "refusal") throw new Error("Model refused the request");
    if (res.stop_reason === "max_tokens") throw new Error("Model output truncated (max tokens)");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const u = res.usage;
    return {
      json: extractJson(text),
      text,
      latencyMs,
      model: res.model,
      usage: {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/* ---------------- OpenAI: Responses API text.format json_schema strict; reasoning.effort ---------------- */
class OpenAIProvider implements LLMProvider {
  id = "openai" as const;
  private client = new OpenAI({ maxRetries: 4, timeout: 240_000 });
  async judge(req: JudgeRequest): Promise<JudgeResponse> {
    const key = `openai/${req.model}`;
    const call = (withReasoning: boolean) =>
      this.client.responses.create({
        model: req.model,
        instructions: req.system,
        input: req.user,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        ...(withReasoning ? { reasoning: { effort: req.reasoning } } : {}),
        text: { format: { type: "json_schema", name: "qa_evaluation", schema: req.schema, strict: true } },
      });
    const [res, latencyMs] = await timed(async () => {
      if (noReasoning.has(key)) return call(false);
      try {
        return await call(true);
      } catch (e) {
        if (!rejectsReasoning(e)) throw e;
        noReasoning.add(key);
        return call(false);
      }
    });
    if (res.status === "incomplete") throw new Error(`Model output incomplete: ${res.incomplete_details?.reason ?? "unknown"}`);
    const text = res.output_text;
    const u = res.usage;
    const cached = u?.input_tokens_details?.cached_tokens ?? 0;
    return {
      json: extractJson(text),
      text,
      latencyMs,
      model: res.model,
      usage: {
        inputTokens: (u?.input_tokens ?? 0) - cached,
        outputTokens: u?.output_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
    };
  }
}

/* ---------------- Gemini: responseJsonSchema; reasoning -> thinkingLevel ---------------- */
const GEMINI_LEVEL: Record<Reasoning, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};
class GeminiProvider implements LLMProvider {
  id = "gemini" as const;
  private client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY });
  async judge(req: JudgeRequest): Promise<JudgeResponse> {
    const key = `gemini/${req.model}`;
    const call = (withReasoning: boolean) =>
      withTransportRetry(() =>
        this.client.models.generateContent({
          model: req.model,
          contents: req.user,
          config: {
            systemInstruction: req.system,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            responseMimeType: "application/json",
            responseJsonSchema: req.schema,
            ...(withReasoning ? { thinkingConfig: { thinkingLevel: GEMINI_LEVEL[req.reasoning] } } : {}),
          },
        }),
      );
    const [res, latencyMs] = await timed(async () => {
      if (noReasoning.has(key)) return call(false);
      try {
        return await call(true);
      } catch (e) {
        if (!rejectsReasoning(e)) throw e;
        noReasoning.add(key);
        return call(false);
      }
    });
    const finish = res.candidates?.[0]?.finishReason;
    if (finish && /MAX_TOKENS/.test(String(finish))) throw new Error("Model output truncated (max tokens)");
    const text = res.text ?? "";
    const u = res.usageMetadata;
    const cached = u?.cachedContentTokenCount ?? 0;
    return {
      json: extractJson(text),
      text,
      latencyMs,
      model: res.modelVersion ?? req.model,
      usage: {
        inputTokens: (u?.promptTokenCount ?? 0) - cached,
        outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
    };
  }
}

/* ---------------- Ollama (local): /api/chat with `format` = JSON schema ---------------- */
class OllamaProvider implements LLMProvider {
  id = "ollama" as const;
  async judge(req: JudgeRequest): Promise<JudgeResponse> {
    const base = process.env.OLLAMA_URL ?? "http://localhost:11434";
    // The KV cache for the whole window is allocated up front, so a large window eats memory a
    // 24 GB Mac needs for the weights. 16k covers system prompt + any chat; raise it for long calls.
    const numCtx = Number(process.env.OLLAMA_NUM_CTX) || 16384;
    // Unset = the model's own default. "false" skips the reasoning pass (much faster on Qwen3.x).
    const think = process.env.OLLAMA_THINK ? process.env.OLLAMA_THINK === "true" : undefined;
    const [data, latencyMs] = await timed(() =>
      withTransportRetry(async () => {
        const r = await fetch(`${base}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: req.model,
            stream: false,
            format: req.schema,
            ...(think === undefined ? {} : { think }),
            options: { num_ctx: numCtx, num_predict: MAX_OUTPUT_TOKENS },
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
          }),
        });
        if (!r.ok) {
          const err: any = new Error(`Ollama ${r.status}: ${await r.text()}`);
          err.status = r.status;
          throw err;
        }
        return (await r.json()) as any;
      }),
    );
    if (data.done_reason === "length") throw new Error("Model output truncated (max tokens)");
    const text = data.message?.content ?? "";
    return {
      json: extractJson(text),
      text,
      latencyMs,
      model: req.model,
      usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

const cache = new Map<string, LLMProvider>();
export function getProvider(id: ProviderId): LLMProvider {
  if (!cache.has(id)) {
    const p =
      id === "anthropic" ? new AnthropicProvider()
      : id === "openai" ? new OpenAIProvider()
      : id === "gemini" ? new GeminiProvider()
      : id === "ollama" ? new OllamaProvider()
      : null;
    if (!p) throw new Error(`Unknown provider ${id}`);
    cache.set(id, p);
  }
  return cache.get(id)!;
}
