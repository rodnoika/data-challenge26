import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { decide } from "@/core/benchmark";
import { getSettings } from "@/server/db";
import { handle, ok } from "@/server/http";
import { loadRegistry } from "@/server/registry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Benchmark summaries (benchmarks/*.json): metrics only, no transcripts. */
export const GET = handle(async (req: Request) => {
  const dir = path.join(process.cwd(), "benchmarks");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse() : [];
  const want = new URL(req.url).searchParams.get("file");
  const file = want && files.includes(want) ? want : files.find((f) => !f.includes("smoke")) ?? files[0] ?? null;
  const data = file ? JSON.parse(readFileSync(path.join(dir, file), "utf8")) : null;
  const cap = Number(new URL(req.url).searchParams.get("cap") ?? data?.meta?.costCap ?? 0.15);
  const decision = data && data.meta.split !== "smoke" ? decide(data.candidates, cap) : null;
  return ok({ files, file, data, decision, cap, registry: loadRegistry(), settings: getSettings() });
});
