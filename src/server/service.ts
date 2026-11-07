import type { Checklist, Dialogue } from "@/core/types";
import {
  createBatch,
  getActiveChecklist,
  getChecklist,
  getDialogue,
  getEvaluation,
  getSettings,
  insertEvaluation,
  listDialogues,
  updateBatch,
  upsertDialogues,
} from "./db";
import { evaluateDialogue } from "./evaluator";

/* ---------- organisers' API (proxied server-side: no CORS in the browser) ---------- */

export function organiserUrl(groupId: string): string {
  const base = process.env.ORGANISER_API_URL;
  if (!base) throw new Error("ORGANISER_API_URL is not set (see .env.example)");
  const u = new URL(base);
  u.searchParams.set("group_id", groupId);
  return u.toString();
}

export function normaliseRecords(payload: unknown): Dialogue[] {
  const p = payload as any;
  const records = Array.isArray(p) ? p : p?.data?.records ?? p?.records ?? (p?.conversation_id ? [p] : null);
  if (!Array.isArray(records)) throw new Error("Unexpected payload: expected data.records[] or an array of dialogues");
  return records.map((r: any) => {
    if (!r?.conversation_id || !Array.isArray(r?.transcript)) throw new Error("Each record needs conversation_id and transcript[]");
    return {
      conversation_id: String(r.conversation_id),
      channel: String(r.channel ?? "agent chat"),
      language: String(r.language ?? ""),
      transcript: r.transcript.map((t: any) => ({
        timestamp: String(t.timestamp ?? ""),
        speaker: String(t.speaker ?? "").toLowerCase(),
        text: String(t.text ?? ""),
      })),
      audio_url: r.audio_url ?? null,
    };
  });
}

export async function fetchDataset(groupId: string) {
  const res = await fetch(organiserUrl(groupId), { cache: "no-store" });
  if (!res.ok) throw new Error(`Organiser API ${res.status}`);
  const body = (await res.json()) as any;
  if (body?.isSuccess === false) throw new Error(`Organiser API error: ${body?.error || "isSuccess=false"}`);
  const dialogues = normaliseRecords(body);
  const gid = body?.data?.dataset_group_id ?? groupId;
  upsertDialogues(dialogues, gid, "api");
  return { groupId: gid, count: dialogues.length };
}

/* ---------- evaluation ---------- */

export async function runEvaluation(dialogueId: string, checklistId?: string) {
  const d = getDialogue(dialogueId);
  if (!d) throw new Error(`Dialogue ${dialogueId} not found`);
  const cl: Checklist = (checklistId && getChecklist(checklistId)) || getActiveChecklist();
  const s = getSettings();
  try {
    const out = await evaluateDialogue(d, cl, { provider: s.provider, model: s.model, samples: s.samples, effort: s.effort });
    const id = insertEvaluation({
      dialogueId,
      checklist: cl,
      provider: s.provider,
      model: out.model,
      samples: out.samplesOk,
      status: "done",
      judgments: out.judgments,
      facts: out.facts,
      raw: { promptVersion: out.promptVersion, samples: out.raw },
      total: out.score.total,
      gross: out.score.grossError,
      usage: out.usage,
      costUsd: out.costUsd,
      latencyMs: out.latencyMs,
    });
    return getEvaluation(id)!;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    insertEvaluation({
      dialogueId,
      checklist: cl,
      provider: s.provider,
      model: s.model,
      samples: 0,
      status: "error",
      error: msg,
      judgments: [],
      facts: null,
      raw: null,
      total: null,
      gross: false,
      usage: {},
      costUsd: null,
      latencyMs: 0,
    });
    throw e;
  }
}

/** Runs in the background inside the server process; progress is persisted in batch_jobs. */
export function startBatch(groupId: string, opts: { onlyMissing?: boolean; ids?: string[] } = {}) {
  let ids = opts.ids?.length
    ? opts.ids
    : listDialogues({ group: groupId })
        .filter((d) => !opts.onlyMissing || !d.evaluation || d.evaluation.status !== "done")
        .map((d) => d.id);
  const jobId = createBatch(groupId, ids.length);
  const conc = Math.max(1, getSettings().concurrency);
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        await runEvaluation(id);
        updateBatch(jobId, { doneInc: 1 });
      } catch (e) {
        updateBatch(jobId, { failedInc: 1, error: `${id}: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  };
  void Promise.all(Array.from({ length: Math.min(conc, ids.length || 1) }, worker)).then(() =>
    updateBatch(jobId, { finished: true }),
  );
  ids = [];
  return jobId;
}

/* ---------- audio: the organisers' link is an HTML player page; resolve the mp3 inside ---------- */

const audioCache = new Map<string, string>();

export async function resolveAudioSource(dialogueId: string): Promise<string> {
  if (audioCache.has(dialogueId)) return audioCache.get(dialogueId)!;
  const d = getDialogue(dialogueId);
  if (!d?.audio_url) throw new Error("No recording for this dialogue");
  const res = await fetch(d.audio_url, { cache: "no-store" });
  const type = res.headers.get("content-type") ?? "";
  let src = d.audio_url;
  if (type.includes("text/html")) {
    const html = await res.text();
    const m = /<source[^>]+src="([^"]+)"/i.exec(html) ?? /<audio[^>]+src="([^"]+)"/i.exec(html);
    if (!m) throw new Error("Audio source not found in player page");
    src = m[1].replace(/&amp;/g, "&");
  }
  audioCache.set(dialogueId, src);
  return src;
}
