import { activateChecklist, getChecklist } from "@/server/db";
import { handle, ok, type Ctx } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = handle(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  activateChecklist(id);
  return ok({ checklist: getChecklist(id) });
});
