import { fetchAudioWithRefresh } from "@/core/audio";
import { resolveAudioSource } from "@/server/service";
import { fail, type Ctx } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams the call recording through the backend (Range requests supported, so the player can seek). */
export async function GET(req: Request, ctx: Ctx<{ id: string }>) {
  try {
    const { id } = await ctx.params;
    const dialogueId = decodeURIComponent(id);
    const headers: Record<string, string> = {};
    const range = req.headers.get("range");
    if (range) headers.range = range;
    const upstream = await fetchAudioWithRefresh((fresh) => resolveAudioSource(dialogueId, fresh), headers);
    const out = new Headers();
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
    out.set("cache-control", "private, max-age=3600");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (e) {
    return fail(e, 502);
  }
}
