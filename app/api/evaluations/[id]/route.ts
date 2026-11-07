import { getEvaluation } from "@/server/db";
import { fail, handle, ok, type Ctx } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handle(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const e = getEvaluation(id);
  return e ? ok({ evaluation: e }) : fail("Evaluation not found", 404);
});
