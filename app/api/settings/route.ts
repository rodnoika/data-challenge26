import { getSettings, resetModelSettings, saveSettings } from "@/server/db";
import { handle, ok } from "@/server/http";
import { hasKey, loadRegistry, PROVIDER_IDS } from "@/server/registry";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const info = () => {
  const reg = loadRegistry();
  return {
    settings: getSettings(),
    providers: PROVIDER_IDS,
    registry: reg,
    keys: Object.fromEntries(PROVIDER_IDS.map((p) => [p, hasKey(p)])),
  };
};

export const GET = handle(async () => ok(info()));

export const PUT = handle(async (req: Request) => {
  const body = await req.json();
  if (body?.reset) resetModelSettings();
  else {
    const allowed = ["provider", "model", "samples", "reasoning", "concurrency", "ensemble"] as const;
    saveSettings(Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => (allowed as readonly string[]).includes(k))));
  }
  return ok(info());
});
