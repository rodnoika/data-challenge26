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
  const settings = getSettings();
  const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  // By default show the newest benchmark that measured the configured model, so the page explains the
  // current choice; a newer run of other candidates only (e.g. local models) stays one click away.
  const withDefault = () =>
    files.find((f) => {
      if (f.includes("smoke")) return false;
      try {
        return (read(f).candidates ?? []).some((c: { provider?: string; model?: string }) => c.provider === settings.provider && c.model === settings.model);
      } catch {
        return false;
      }
    });
  const file = want && files.includes(want) ? want : withDefault() ?? files.find((f) => !f.includes("smoke")) ?? files[0] ?? null;
  const data = file ? read(file) : null;
  const cap = Number(new URL(req.url).searchParams.get("cap") ?? data?.meta?.costCap ?? 0.15);
  const decision = data && data.meta.split !== "smoke" ? decide(data.candidates, cap) : null;
  return ok({ files, file, data, decision, cap, registry: loadRegistry(), settings });
});
