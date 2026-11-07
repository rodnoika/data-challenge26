import { getSettings, saveSettings } from "@/server/db";
import { handle, ok } from "@/server/http";
import { PROVIDER_IDS, PRICES } from "@/server/providers";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () =>
  ok({
    settings: getSettings(),
    providers: PROVIDER_IDS,
    knownPrices: PRICES,
    keys: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    },
  }),
);
export const PUT = handle(async (req: Request) => ok({ settings: saveSettings(await req.json()) }));
