import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import type { Usage } from "@/core/types";
import { extractJson } from "@/core/prompt";

export interface JudgeRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface JudgeResponse {
  json: unknown;
  text: string;
  usage: Usage;
  model: string;
}

export interface LLMProvider {
  id: ProviderId;
  judge(req: JudgeRequest): Promise<JudgeResponse>;
}

export type ProviderId = "anthropic" | "openai" | "gemini" | "ollama";

/** USD per 1M tokens. Unknown models -> cost not reported. Edit as needed. */
export const PRICES: Record<string, { in: number; out: number; cacheRead?: number; cacheWrite?: number }> = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-fable-5-1": { in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};

export function costUsd(model: string, u: Usage): number | null {
  const envIn = Number(process.env.CQA_PRICE_IN);
  const envOut = Number(process.env.CQA_PRICE_OUT);
  const p = PRICES[model] ?? (envIn > 0 && envOut > 0 ? { in: envIn, out: envOut } : null);
  if (!p) return null;
  const cr = p.cacheRead ?? p.in;
  const cw = p.cacheWrite ?? p.in;
  return (u.inputTokens * p.in + u.outputTokens * p.out + u.cacheReadTokens * cr + u.cacheWriteTokens * cw) / 1e6;
}

class AnthropicProvider implements LLMProvider {
  id = "anthropic" as const;
  private client = new Anthropic({ maxRetries: 4, timeout: 240_000 });
  async judge(req: JudgeRequest): Promise<JudgeResponse> {
    const res = await this.client.messages.create({
      model: req.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: req.effort ?? "medium", format: { type: "json_schema", schema: req.schema } },
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.user }],
    });
    if (res.stop_reason === "refusal") throw new Error("Model refused the request");
    if (res.stop_reason === "max_tokens") throw new Error("Model output truncated (max_tokens)");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const u = res.usage;
    return {
      json: extractJson(text),
      text,
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

class OpenAIProvider implements LLMProvider {
  id = "openai" as const;
  private client = new OpenAI({ maxRetries: 4, timeout: 240_000 });
  async judge(req: JudgeRequest): Promise<JudgeResponse> {
    const res = await this.client.responses.create({
      model: req.model,
      instructions: req.system,
      input: req.user,
      text: { format: { type: "json_schema", name: "qa_evaluation", schema: req.schema, strict: true } },
    });
    const text = res.output_text;
    const u = res.usage;
    const cached = u?.input_tokens_details?.cached_tokens ?? 0;
    return {
      json: extractJson(text),
      text,
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

class GeminiProvider implements LLMProvider {
  id = "gemini" as const;
  private client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY });
  async judge(req: JudgeRequest): Promise<JudgeResponse> {
    const res = await this.client.models.generateContent({
      model: req.model,
      contents: req.user,
      config: {
        systemInstruction: req.system,
        responseMimeType: "application/json",
        responseJsonSchema: req.schema,
      },
    });
    const text = res.text ?? "";
    const u = res.usageMetadata;
    return {
      json: extractJson(text),
      text,
      model: req.model,
      usage: {
        inputTokens: u?.promptTokenCount ?? 0,
        outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }
}

/** Local model through Ollama's OpenAI-compatible endpoint (structured output via JSON schema). */
class OllamaProvider implements LLMProvider {
  id = "ollama" as const;
  async judge(req: JudgeRequest): Promise<JudgeResponse> {
    const base = process.env.OLLAMA_URL ?? "http://localhost:11434";
    const r = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        stream: false,
        format: req.schema,
        options: { num_ctx: 32768 },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
    });
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
    const data = (await r.json()) as any;
    const text = data.message?.content ?? "";
    return {
      json: extractJson(text),
      text,
      model: req.model,
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    };
  }
}

const cache = new Map<string, LLMProvider>();
export function getProvider(id: ProviderId): LLMProvider {
  if (!cache.has(id)) {
    const p =
      id === "anthropic"
        ? new AnthropicProvider()
        : id === "openai"
          ? new OpenAIProvider()
          : id === "gemini"
            ? new GeminiProvider()
            : id === "ollama"
              ? new OllamaProvider()
              : null;
    if (!p) throw new Error(`Unknown provider ${id}`);
    cache.set(id, p);
  }
  return cache.get(id)!;
}

export const PROVIDER_IDS: ProviderId[] = ["anthropic", "openai", "gemini", "ollama"];
