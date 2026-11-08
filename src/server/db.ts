import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_CHECKLIST, migrateRules } from "@/core/defaultChecklist";
import { score } from "@/core/scoring";
import type { Answer, Appeal, Checklist, Dialogue, EvaluationRecord, Judgment, Review } from "@/core/types";
import type { Facts } from "@/core/facts";
import { defaultModel, type ProviderId } from "./registry";

const DB_PATH = process.env.CQA_DB ?? path.join(process.cwd(), "data", "cqa.db");

type DB = Database.Database;
const g = globalThis as unknown as { __cqaDb?: DB };

export function db(): DB {
  if (g.__cqaDb) return g.__cqaDb;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.pragma("busy_timeout = 5000");
  d.exec(`
    CREATE TABLE IF NOT EXISTS dialogues (
      id TEXT PRIMARY KEY, group_id TEXT, channel TEXT, language TEXT,
      transcript TEXT NOT NULL, audio_url TEXT, source TEXT, fetched_at TEXT
    );
    CREATE TABLE IF NOT EXISTS checklists (
      pk INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, version INTEGER NOT NULL,
      name TEXT NOT NULL, body TEXT NOT NULL, is_active INTEGER DEFAULT 0, created_at TEXT,
      UNIQUE(id, version)
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY, dialogue_id TEXT NOT NULL, checklist_id TEXT, checklist_version INTEGER,
      checklist_body TEXT, provider TEXT, model TEXT, samples INTEGER, status TEXT, error TEXT,
      judgments TEXT, facts TEXT, raw TEXT, total REAL, gross INTEGER, usage TEXT, cost_usd REAL,
      latency_ms INTEGER, created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ev_dialogue ON evaluations(dialogue_id, created_at);
    CREATE TABLE IF NOT EXISTS appeals (
      id TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL, dialogue_id TEXT, criterion_id TEXT NOT NULL,
      comment TEXT, status TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY, appeal_id TEXT NOT NULL, decision TEXT, new_answer TEXT, reason TEXT, reviewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS batch_jobs (
      id TEXT PRIMARY KEY, group_id TEXT, total INTEGER, done INTEGER, failed INTEGER, status TEXT,
      errors TEXT, created_at TEXT, finished_at TEXT
    );
  `);
  const n = d.prepare("SELECT COUNT(*) c FROM checklists").get() as { c: number };
  if (n.c === 0) {
    d.prepare("INSERT INTO checklists (id, version, name, body, is_active, created_at) VALUES (?,?,?,?,1,?)").run(
      DEFAULT_CHECKLIST.id,
      1,
      DEFAULT_CHECKLIST.name,
      JSON.stringify(DEFAULT_CHECKLIST),
      new Date().toISOString(),
    );
  }
  // Saving in the editor always creates a new version, so version 1 of the default is never user-edited:
  // it follows the code. Past evaluations keep their own snapshot of the checklist.
  d.prepare("UPDATE checklists SET body = ? WHERE id = ? AND version = 1").run(JSON.stringify(DEFAULT_CHECKLIST), DEFAULT_CHECKLIST.id);
  for (const row of d.prepare("SELECT pk, body FROM checklists WHERE NOT (id = ? AND version = 1)").all(DEFAULT_CHECKLIST.id) as { pk: number; body: string }[]) {
    const body = JSON.parse(row.body);
    const rules = migrateRules(body.rules ?? "");
    if (rules !== body.rules) d.prepare("UPDATE checklists SET body = ? WHERE pk = ?").run(JSON.stringify({ ...body, rules }), row.pk);
  }
  g.__cqaDb = d;
  return d;
}

const now = () => new Date().toISOString();

/* ---------------- settings ---------------- */

export interface Settings {
  provider: ProviderId;
  model: string;
  samples: number;
  /** Neutral reasoning level; each adapter maps it to its vendor's own control. */
  reasoning: "low" | "medium" | "high";
  concurrency: number;
  /** Optional cross-vendor ensemble (one vote per entry). Overrides provider/model/samples when set. */
  ensemble: { provider: ProviderId; model: string }[] | null;
  /** Where provider/model came from: explicit UI choice, env, or the registry default. */
  source: string;
}

export function getSettings(): Settings {
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const s = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  const def = defaultModel() as ReturnType<typeof defaultModel> & { samples?: number; ensemble?: Settings["ensemble"] };
  const explicit = s.provider && s.model;
  const fromEnv = !explicit && process.env.CQA_PROVIDER && process.env.CQA_MODEL;
  return {
    provider: (explicit ? s.provider : fromEnv ? process.env.CQA_PROVIDER : def.provider) as ProviderId,
    model: explicit ? s.model : fromEnv ? process.env.CQA_MODEL! : def.model,
    // An empty CQA_SAMPLES= (as in .env.example) means "not set", not zero votes.
    samples: Math.max(1, Number(s.samples ?? (process.env.CQA_SAMPLES || undefined) ?? def.samples ?? 1)),
    reasoning: s.reasoning ?? "medium",
    concurrency: Number(s.concurrency ?? process.env.CQA_CONCURRENCY ?? 5),
    ensemble: s.ensemble !== undefined ? s.ensemble : (explicit || fromEnv ? null : def.ensemble ?? null),
    source: explicit ? "выбрано в настройках" : fromEnv ? "из .env" : def.chosenBy,
  };
}

/** Forget explicit UI choices so the registry default (benchmark winner) applies again. */
export function resetModelSettings() {
  db().prepare("DELETE FROM settings WHERE key IN ('provider','model','samples','ensemble')").run();
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const st = db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) st.run(k, JSON.stringify(v));
  return getSettings();
}

/* ---------------- dialogues ---------------- */

export function upsertDialogues(list: Dialogue[], groupId: string | null, source: "api" | "upload"): number {
  const st = db().prepare(`INSERT INTO dialogues (id, group_id, channel, language, transcript, audio_url, source, fetched_at)
    VALUES (@id, @group_id, @channel, @language, @transcript, @audio_url, @source, @fetched_at)
    ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id, channel=excluded.channel, language=excluded.language,
      transcript=excluded.transcript, audio_url=excluded.audio_url, source=excluded.source, fetched_at=excluded.fetched_at`);
  const tx = db().transaction((items: Dialogue[]) => {
    for (const d of items)
      st.run({
        id: d.conversation_id,
        group_id: groupId ?? d.group_id ?? "UPLOAD",
        channel: d.channel ?? "agent chat",
        language: d.language ?? "",
        transcript: JSON.stringify(d.transcript ?? []),
        audio_url: d.audio_url ?? null,
        source,
        fetched_at: now(),
      });
  });
  tx(list);
  return list.length;
}

function rowToDialogue(r: any): Dialogue {
  return {
    conversation_id: r.id,
    channel: r.channel,
    language: r.language,
    transcript: JSON.parse(r.transcript),
    audio_url: r.audio_url,
    group_id: r.group_id,
  };
}

export function getDialogue(id: string): Dialogue | null {
  const r = db().prepare("SELECT * FROM dialogues WHERE id = ?").get(id);
  return r ? rowToDialogue(r) : null;
}

export function listDialogues(filter: { group?: string | null }) {
  const rows = db()
    .prepare(
      `SELECT d.id, d.group_id, d.channel, d.language, d.audio_url, json_array_length(d.transcript) AS turns,
        e.id AS eval_id, e.total, e.gross, e.status, e.model, e.created_at AS evaluated_at, e.judgments, e.cost_usd,
        (SELECT COUNT(*) FROM appeals a WHERE a.dialogue_id = d.id AND a.status = 'open') AS open_appeals
       FROM dialogues d
       LEFT JOIN evaluations e ON e.id = (SELECT id FROM evaluations WHERE dialogue_id = d.id ORDER BY created_at DESC LIMIT 1)
       ${filter.group ? "WHERE d.group_id = @group" : ""}
       ORDER BY d.group_id, d.id`,
    )
    .all(filter.group ? { group: filter.group } : {}) as any[];
  return rows.map((r) => {
    const judgments: Judgment[] = r.judgments ? JSON.parse(r.judgments) : [];
    const ev = r.eval_id ? getEvaluation(r.eval_id) : null;
    return {
      id: r.id,
      groupId: r.group_id,
      channel: r.channel,
      language: r.language,
      hasAudio: !!r.audio_url,
      turns: r.turns,
      evaluation: ev
        ? {
            id: ev.id,
            status: ev.status,
            total: ev.finalScore.total,
            originalTotal: ev.score.total,
            gross: ev.finalScore.grossError,
            model: ev.model,
            checklistId: ev.checklistId,
            checklistVersion: ev.checklistVersion,
            evaluatedAt: ev.createdAt,
            lowConfidence: judgments.filter((j) => j.confidence === "low").map((j) => j.criterionId),
            answers: Object.fromEntries(ev.finalJudgments.map((j) => [j.criterionId, j.answer])),
            costUsd: r.cost_usd,
          }
        : null,
      openAppeals: r.open_appeals,
    };
  });
}

export function listGroups(): { groupId: string; count: number }[] {
  return db().prepare("SELECT group_id AS groupId, COUNT(*) AS count FROM dialogues GROUP BY group_id ORDER BY group_id").all() as any;
}

/* ---------------- checklists ---------------- */

export function listChecklists() {
  const rows = db()
    .prepare(
      `SELECT c.id, c.name, MAX(c.version) AS version, MAX(c.is_active) AS is_active, MAX(c.created_at) AS updated_at
       FROM checklists c GROUP BY c.id ORDER BY updated_at DESC`,
    )
    .all() as any[];
  return rows.map((r) => ({ id: r.id, name: r.name, version: r.version, isActive: !!r.is_active, updatedAt: r.updated_at }));
}

export function getChecklist(id: string, version?: number): Checklist | null {
  const r = (
    version
      ? db().prepare("SELECT * FROM checklists WHERE id = ? AND version = ?").get(id, version)
      : db().prepare("SELECT * FROM checklists WHERE id = ? ORDER BY version DESC LIMIT 1").get(id)
  ) as any;
  if (!r) return null;
  const isActive = !!(db().prepare("SELECT MAX(is_active) a FROM checklists WHERE id = ?").get(id) as any).a;
  return { ...JSON.parse(r.body), id: r.id, version: r.version, isActive, createdAt: r.created_at };
}

export function getActiveChecklist(): Checklist {
  const r = db().prepare("SELECT id, version FROM checklists WHERE is_active = 1 ORDER BY version DESC LIMIT 1").get() as any;
  return (r && getChecklist(r.id, r.version)) || getChecklist(DEFAULT_CHECKLIST.id) || DEFAULT_CHECKLIST;
}

/** Saving always creates a new version; old evaluations keep pointing at the version they used. */
export function saveChecklist(cl: Checklist, activate: boolean): Checklist {
  const id = cl.id || `cl-${randomUUID().slice(0, 8)}`;
  const prev = db().prepare("SELECT MAX(version) v FROM checklists WHERE id = ?").get(id) as any;
  const version = (prev?.v ?? 0) + 1;
  const body: Checklist = { ...cl, id, version };
  delete body.isActive;
  delete body.createdAt;
  db().transaction(() => {
    if (activate) db().prepare("UPDATE checklists SET is_active = 0").run();
    db()
      .prepare("INSERT INTO checklists (id, version, name, body, is_active, created_at) VALUES (?,?,?,?,?,?)")
      .run(id, version, cl.name, JSON.stringify(body), activate ? 1 : 0, now());
  })();
  return getChecklist(id, version)!;
}

export function activateChecklist(id: string) {
  db().transaction(() => {
    db().prepare("UPDATE checklists SET is_active = 0").run();
    db().prepare("UPDATE checklists SET is_active = 1 WHERE id = ? AND version = (SELECT MAX(version) FROM checklists WHERE id = ?)").run(id, id);
  })();
}

export function deleteChecklist(id: string) {
  db().prepare("DELETE FROM checklists WHERE id = ?").run(id);
}

/* ---------------- evaluations ---------------- */

export interface FullEvaluation extends EvaluationRecord {
  promptVersion: string | null;
  reasoning: string | null;
  checklist: Checklist;
  facts: Facts;
  appeals: Appeal[];
  finalJudgments: Judgment[];
  finalScore: EvaluationRecord["score"];
}

export function insertEvaluation(e: {
  dialogueId: string;
  checklist: Checklist;
  provider: string;
  model: string;
  samples: number;
  status: "done" | "error";
  error?: string | null;
  judgments: Judgment[];
  facts: Facts | null;
  raw: unknown;
  total: number | null;
  gross: boolean;
  usage: unknown;
  costUsd: number | null;
  latencyMs: number;
}): string {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO evaluations (id, dialogue_id, checklist_id, checklist_version, checklist_body, provider, model, samples,
        status, error, judgments, facts, raw, total, gross, usage, cost_usd, latency_ms, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      e.dialogueId,
      e.checklist.id,
      e.checklist.version,
      JSON.stringify(e.checklist),
      e.provider,
      e.model,
      e.samples,
      e.status,
      e.error ?? null,
      JSON.stringify(e.judgments),
      JSON.stringify(e.facts),
      JSON.stringify(e.raw),
      e.total,
      e.gross ? 1 : 0,
      JSON.stringify(e.usage),
      e.costUsd,
      e.latencyMs,
      now(),
    );
  return id;
}

/** Apply reviewer decisions on top of the original judgments. */
export function applyReviews(judgments: Judgment[], appeals: Appeal[]): Judgment[] {
  const changed = new Map<string, Answer>();
  for (const a of appeals) if (a.review?.decision === "changed" && a.review.newAnswer !== null) changed.set(a.criterionId, a.review.newAnswer);
  return judgments.map((j) => (changed.has(j.criterionId) ? { ...j, answer: changed.get(j.criterionId)! } : j));
}

export function getEvaluation(id: string): FullEvaluation | null {
  const r = db()
    .prepare("SELECT *, json_extract(raw, '$.promptVersion') AS prompt_version, json_extract(raw, '$.reasoning') AS reasoning FROM evaluations WHERE id = ?")
    .get(id) as any;
  if (!r) return null;
  const checklist: Checklist = JSON.parse(r.checklist_body);
  const judgments: Judgment[] = JSON.parse(r.judgments ?? "[]");
  const appeals = listAppeals({ evaluationId: id });
  const finalJudgments = applyReviews(judgments, appeals);
  const original = score(checklist, judgments);
  return {
    id: r.id,
    dialogueId: r.dialogue_id,
    checklistId: r.checklist_id,
    checklistVersion: r.checklist_version,
    provider: r.provider,
    model: r.model,
    samples: r.samples,
    promptVersion: r.prompt_version ?? null,
    reasoning: r.reasoning ?? null,
    status: r.status,
    error: r.error,
    judgments,
    score: original,
    usage: JSON.parse(r.usage ?? "{}"),
    costUsd: r.cost_usd,
    latencyMs: r.latency_ms,
    createdAt: r.created_at,
    checklist,
    facts: JSON.parse(r.facts ?? "null"),
    appeals,
    finalJudgments,
    finalScore: score(checklist, finalJudgments),
  };
}

/** What the model was sent and what it answered. Read on demand: it is large and only the journal shows it. */
export function getEvaluationRaw(id: string): unknown {
  const r = db().prepare("SELECT raw FROM evaluations WHERE id = ?").get(id) as { raw: string | null } | undefined;
  return r?.raw ? JSON.parse(r.raw) : null;
}

export function listEvaluationsForDialogue(dialogueId: string) {
  return db()
    .prepare("SELECT id, model, provider, total, gross, status, error, checklist_id, checklist_version, created_at, cost_usd FROM evaluations WHERE dialogue_id = ? ORDER BY created_at DESC")
    .all(dialogueId);
}

/* ---------------- appeals ---------------- */

function rowToAppeal(r: any): Appeal {
  const rv = db().prepare("SELECT * FROM reviews WHERE appeal_id = ? ORDER BY reviewed_at DESC LIMIT 1").get(r.id) as any;
  const review: Review | null = rv
    ? {
        id: rv.id,
        appealId: rv.appeal_id,
        decision: rv.decision,
        newAnswer: rv.new_answer === null ? null : JSON.parse(rv.new_answer),
        reason: rv.reason,
        reviewedAt: rv.reviewed_at,
      }
    : null;
  return {
    id: r.id,
    evaluationId: r.evaluation_id,
    dialogueId: r.dialogue_id,
    criterionId: r.criterion_id,
    comment: r.comment,
    status: r.status,
    createdAt: r.created_at,
    review,
  };
}

export function listAppeals(f: { evaluationId?: string; status?: string }): Appeal[] {
  const where: string[] = [];
  const args: any[] = [];
  if (f.evaluationId) (where.push("evaluation_id = ?"), args.push(f.evaluationId));
  if (f.status) (where.push("status = ?"), args.push(f.status));
  const rows = db()
    .prepare(`SELECT * FROM appeals ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`)
    .all(...args);
  return rows.map(rowToAppeal);
}

export function createAppeal(evaluationId: string, criterionId: string, comment: string): Appeal {
  const ev = db().prepare("SELECT dialogue_id FROM evaluations WHERE id = ?").get(evaluationId) as any;
  if (!ev) throw new Error("Evaluation not found");
  const open = db().prepare("SELECT id FROM appeals WHERE evaluation_id = ? AND criterion_id = ? AND status = 'open'").get(evaluationId, criterionId);
  if (open) throw new Error("По этому критерию уже есть открытая апелляция");
  const id = randomUUID();
  db()
    .prepare("INSERT INTO appeals (id, evaluation_id, dialogue_id, criterion_id, comment, status, created_at) VALUES (?,?,?,?,?, 'open', ?)")
    .run(id, evaluationId, ev.dialogue_id, criterionId, comment, now());
  return rowToAppeal(db().prepare("SELECT * FROM appeals WHERE id = ?").get(id));
}

export function reviewAppeal(appealId: string, decision: "upheld" | "changed", newAnswer: Answer | null, reason: string): Appeal {
  const a = db().prepare("SELECT * FROM appeals WHERE id = ?").get(appealId) as any;
  if (!a) throw new Error("Appeal not found");
  db().transaction(() => {
    db()
      .prepare("INSERT INTO reviews (id, appeal_id, decision, new_answer, reason, reviewed_at) VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), appealId, decision, decision === "changed" ? JSON.stringify(newAnswer) : null, reason, now());
    db().prepare("UPDATE appeals SET status = ? WHERE id = ?").run(decision, appealId);
  })();
  return rowToAppeal(db().prepare("SELECT * FROM appeals WHERE id = ?").get(appealId));
}

/* ---------------- batch jobs ---------------- */

export interface BatchJob {
  id: string;
  groupId: string;
  total: number;
  done: number;
  failed: number;
  status: "running" | "done";
  errors: string[];
  createdAt: string;
  finishedAt: string | null;
}

export function createBatch(groupId: string, total: number): string {
  const id = randomUUID();
  db()
    .prepare("INSERT INTO batch_jobs (id, group_id, total, done, failed, status, errors, created_at) VALUES (?,?,?,0,0,'running','[]',?)")
    .run(id, groupId, total, now());
  return id;
}

export function updateBatch(id: string, patch: { doneInc?: number; failedInc?: number; error?: string; finished?: boolean }) {
  const r = db().prepare("SELECT * FROM batch_jobs WHERE id = ?").get(id) as any;
  if (!r) return;
  const errors: string[] = JSON.parse(r.errors);
  if (patch.error) errors.push(patch.error);
  db()
    .prepare("UPDATE batch_jobs SET done = ?, failed = ?, errors = ?, status = ?, finished_at = ? WHERE id = ?")
    .run(
      r.done + (patch.doneInc ?? 0),
      r.failed + (patch.failedInc ?? 0),
      JSON.stringify(errors),
      patch.finished ? "done" : r.status,
      patch.finished ? now() : r.finished_at,
      id,
    );
}

export function getBatch(id: string): BatchJob | null {
  const r = db().prepare("SELECT * FROM batch_jobs WHERE id = ?").get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    groupId: r.group_id,
    total: r.total,
    done: r.done,
    failed: r.failed,
    status: r.status,
    errors: JSON.parse(r.errors),
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

export function latestBatch(groupId: string): BatchJob | null {
  const r = db().prepare("SELECT id FROM batch_jobs WHERE group_id = ? ORDER BY created_at DESC LIMIT 1").get(groupId) as any;
  return r ? getBatch(r.id) : null;
}

/* ---------------- checklist-version comparison ---------------- */

/** Checklist versions that have finished evaluations in a group, most recently used first. */
export function evaluatedVersions(group: string): { id: string; version: number; dialogues: number; lastAt: string }[] {
  return db()
    .prepare(
      `SELECT e.checklist_id AS id, e.checklist_version AS version, COUNT(DISTINCT e.dialogue_id) AS dialogues, MAX(e.created_at) AS lastAt
       FROM evaluations e JOIN dialogues d ON d.id = e.dialogue_id
       WHERE d.group_id = ? AND e.status = 'done'
       GROUP BY e.checklist_id, e.checklist_version ORDER BY lastAt DESC`,
    )
    .all(group) as any;
}

/** Latest finished evaluation per dialogue of a group, for one checklist version: dialogue id -> evaluation id. */
export function latestEvaluationIds(group: string, checklistId: string, version: number): Map<string, string> {
  const rows = db()
    .prepare(
      `SELECT e.dialogue_id AS dialogueId, e.id AS id FROM evaluations e JOIN dialogues d ON d.id = e.dialogue_id
       WHERE d.group_id = ? AND e.checklist_id = ? AND e.checklist_version = ? AND e.status = 'done'
       ORDER BY e.created_at ASC`,
    )
    .all(group, checklistId, version) as { dialogueId: string; id: string }[];
  return new Map(rows.map((r) => [r.dialogueId, r.id])); // later rows overwrite earlier ones
}
