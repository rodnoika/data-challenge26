import { audioLinkExpiry } from "@/core/audio";
import { checkSourceUrl, defaultAllowedHosts } from "@/core/sourceUrl";
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
import { evaluateDialogue, sameModel, voterLabel } from "./evaluator";

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

/**
 * Loads a dataset from a pasted link (for example a new set the organisers announce).
 * The link itself is never stored or echoed back: it may carry a signature.
 */
export async function fetchDatasetFromUrl(raw: string, groupId?: string) {
  const check = checkSourceUrl(raw, defaultAllowedHosts(process.env.ORGANISER_API_URL, process.env.CQA_FETCH_ALLOWED_HOSTS));
  if (!check.ok) throw new Error(check.error);
  let res: Response;
  try {
    // redirect: "error" keeps an allowed host from bouncing the request to a disallowed one.
    res = await fetch(check.url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new Error("Не удалось получить данные по ссылке: адрес недоступен, перенаправляет или не ответил за 60 с");
  }
  if (!res.ok) throw new Error(`Источник ответил ошибкой ${res.status}`);
  const text = await res.text();
  if (text.length > 50_000_000) throw new Error("Ответ больше 50 МБ");
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("По ссылке пришёл не JSON");
  }
  if (body?.isSuccess === false) throw new Error(`Источник вернул ошибку: ${body?.error || "isSuccess=false"}`);
  const dialogues = normaliseRecords(body);
  const gid = groupId?.trim() || body?.data?.dataset_group_id || check.url.searchParams.get("group_id") || "URL";
  upsertDialogues(dialogues, gid, "api");
  return { groupId: gid, count: dialogues.length };
}

/* ---------- evaluation ---------- */

export async function runEvaluation(dialogueId: string, checklistId?: string) {
  const d = getDialogue(dialogueId);
  if (!d) throw new Error(`Dialogue ${dialogueId} not found`);
  const cl: Checklist = (checklistId && getChecklist(checklistId)) || getActiveChecklist();
  const s = getSettings();
  const voters = s.ensemble?.length ? s.ensemble : sameModel(s.provider, s.model, s.samples);
  const who = voterLabel(voters);
  try {
    const out = await evaluateDialogue(d, cl, { voters, reasoning: s.reasoning });
    const id = insertEvaluation({
      dialogueId,
      checklist: cl,
      provider: out.provider,
      model: out.model,
      samples: out.votes.filter((v) => v.ok).length,
      status: "done",
      judgments: out.judgments,
      facts: out.facts,
      raw: { promptVersion: out.promptVersion, reasoning: out.reasoning, votes: out.votes, responses: out.raw, prompt: out.prompt },
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
      provider: who.provider,
      model: who.model,
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

const audioCache = new Map<string, { src: string; expiresAt: number }>();

export async function resolveAudioSource(dialogueId: string, fresh = false): Promise<string> {
  const cached = audioCache.get(dialogueId);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.src;
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
  audioCache.set(dialogueId, { src, expiresAt: audioLinkExpiry(src) });
  return src;
}
