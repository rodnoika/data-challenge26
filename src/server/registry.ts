import { readFileSync } from "node:fs";
import path from "node:path";
import type { Usage } from "@/core/types";

/** Evaluation-model registry (config/models.json). Prices: USD per 1M tokens, from vendor pricing pages. */

export type ProviderId = "anthropic" | "openai" | "gemini" | "ollama";
export const PROVIDER_IDS: ProviderId[] = ["anthropic", "openai", "gemini", "ollama"];

export interface ModelEntry {
  provider: ProviderId;
  model: string;
  label: string;
  tier: "frontier" | "mid" | "cheap" | "local";
  optional?: boolean;
  price: { in: number; cachedIn?: number; cacheWrite?: number; out: number } | null;
  priceNote?: string;
  priceSource?: string;
  checkedAt: string | null;
}

export interface Registry {
  default: { provider: ProviderId; model: string; chosenBy: string } | null;
  fallback: { provider: ProviderId; model: string; chosenBy: string } | null;
  models: ModelEntry[];
}

export const REGISTRY_PATH = path.join(process.cwd(), "config", "models.json");

export function loadRegistry(): Registry {
  // read on every call: the file is tiny and the bench `--apply` may rewrite it while the server runs
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  return { default: raw.default ?? null, fallback: raw.fallback ?? null, models: raw.models ?? [] };
}

export function findModel(provider: string, model: string): ModelEntry | undefined {
  return loadRegistry().models.find((m) => m.provider === provider && m.model === model);
}

export function hasKey(p: ProviderId): boolean {
  if (p === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
  if (p === "openai") return !!process.env.OPENAI_API_KEY;
  if (p === "gemini") return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  return true; // ollama: local, no key
}

/**
 * Configured default: the benchmark winner when set; otherwise (development placeholder)
 * the first cheap-tier model whose provider has a key. No vendor is preferred by code.
 */
export function defaultModel(): { provider: ProviderId; model: string; chosenBy: string } {
  const r = loadRegistry();
  if (r.default) return r.default;
  const cheap = r.models.find((m) => m.tier === "cheap" && hasKey(m.provider));
  const any = cheap ?? r.models.find((m) => m.provider !== "ollama" && hasKey(m.provider)) ?? r.models[0];
  return { provider: any.provider, model: any.model, chosenBy: "placeholder: no benchmark result yet" };
}

/** Cost in USD from the registry; null when the model has no checked price (never guessed). */
export function costUsd(provider: string, model: string, u: Usage): number | null {
  const m = findModel(provider, model);
  if (!m?.price || (m.provider !== "ollama" && !m.checkedAt)) return null;
  const p = m.price;
  return (
    (u.inputTokens * p.in +
      u.cacheReadTokens * (p.cachedIn ?? p.in) +
      u.cacheWriteTokens * (p.cacheWrite ?? p.in) +
      u.outputTokens * p.out) /
    1e6
  );
}
