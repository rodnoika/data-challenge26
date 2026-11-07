import { getEvaluation, getEvaluationRaw } from "@/server/db";
import { fail, handle, ok, type Ctx } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handle(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  if (new URL(req.url).searchParams.get("raw")) return ok({ raw: getEvaluationRaw(id) });
  const e = getEvaluation(id);
  return e ? ok({ evaluation: e }) : fail("Evaluation not found", 404);
});
