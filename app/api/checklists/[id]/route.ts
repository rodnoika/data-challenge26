import { activateChecklist, deleteChecklist, getActiveChecklist, getChecklist, saveChecklist } from "@/server/db";
import { validateChecklist } from "@/core/scoring";
import { fail, handle, ok, type Ctx } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const v = new URL(req.url).searchParams.get("version");
  const cl = getChecklist(id, v ? Number(v) : undefined);
  return cl ? ok({ checklist: cl }) : fail("Checklist not found", 404);
});

export const PUT = handle(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const { checklist, activate } = await req.json();
  const cl = { ...checklist, id };
  const errs = validateChecklist(cl);
  if (errs.length) return fail(errs.join("\n"));
  return ok({ checklist: saveChecklist(cl, !!activate) });
});

/** Makes the latest version of this checklist the one new evaluations use. */
export const PATCH = handle(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  if (!getChecklist(id)) return fail("Checklist not found", 404);
  activateChecklist(id);
  return ok({ active: getActiveChecklist() });
});

export const DELETE = handle(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  deleteChecklist(id);
  return ok({ ok: true });
});
