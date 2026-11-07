import { listGroups } from "@/server/db";
import { handle, ok } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handle(async () => ok({ groups: listGroups() }));
