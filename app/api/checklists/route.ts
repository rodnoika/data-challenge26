import { getActiveChecklist, listChecklists, saveChecklist } from "@/server/db";
import { validateChecklist } from "@/core/scoring";
import { fail, handle, ok } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => ok({ checklists: listChecklists(), active: getActiveChecklist() }));

export const POST = handle(async (req: Request) => {
  const { checklist, activate } = await req.json();
  const errs = validateChecklist(checklist);
  if (errs.length) return fail(errs.join("\n"));
  return ok({ checklist: saveChecklist(checklist, !!activate) });
});
