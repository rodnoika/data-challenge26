"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, audioUrl } from "@/ui/api";
import { Badge, Button, Card, ErrorNote, Modal, Spinner, cx, inputCls } from "@/ui/kit";
import { answerTone, fmtAnswer, fmtPoints, fmtTime, totalTone } from "@/ui/format";
import { formatClock, type Facts } from "@/core/facts";
import { shiftTurnRefs } from "@/core/submission";
import type { Appeal, Checklist, Criterion, Dialogue, Judgment, ScoreResult } from "@/core/types";

type FullEval = {
  id: string;
  status: string;
  error?: string;
  provider: string;
  model: string;
  samples: number;
  promptVersion: string | null;
  reasoning: string | null;
  createdAt: string;
  costUsd: number | null;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  checklist: Checklist;
  judgments: Judgment[];
  finalJudgments: Judgment[];
  score: ScoreResult;
  finalScore: ScoreResult;
  appeals: Appeal[];
  facts: Facts;
};
type Resp = { dialogue: Dialogue; facts: Facts; evaluation: FullEval | null; history: any[] };

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-500"><Spinner /> Загрузка…</div>}>
      <DialogueCard />
    </Suspense>
  );
}

const SPEAKER: Record<string, { label: string; cls: string }> = {
  client: { label: "Клиент", cls: "bg-white border-slate-200" },
  operator: { label: "Оператор", cls: "bg-brand-50 border-brand-100" },
  bot: { label: "Бот", cls: "bg-slate-50 border-slate-200 text-slate-500" },
  system: { label: "Система", cls: "bg-transparent border-dashed border-slate-300 text-slate-500 italic" },
};

function DialogueCard() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [highlight, setHighlight] = useState<{ ids: Set<number>; span: [number, number] | null; key: number }>({ ids: new Set(), span: null, key: 0 });
  const [appealFor, setAppealFor] = useState<Criterion | null>(null);
  const turnRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioError, setAudioError] = useState(false);

  const load = useCallback(
    async (evaluationId?: string) => {
      try {
        const r = await api<Resp>(`/api/dialogues/${encodeURIComponent(id)}${evaluationId ? `?evaluation=${evaluationId}` : ""}`);
        setData(r);
      } catch (e: any) {
        setError(e.message);
      }
    },
    [id],
  );
  useEffect(() => {
    if (id) load();
  }, [id, load]);

  async function evaluate() {
    setRunning(true);
    setError(null);
    try {
      await api("/api/evaluations", { method: "POST", json: { dialogueId: id } });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  const facts = data?.evaluation?.facts ?? data?.facts;
  const isVoice = facts?.channel === "voice";

  function jump(ids: number[], span: [number, number] | null = null) {
    const first = ids.length ? Math.min(...ids) : span ? span[0] : null;
    setHighlight({ ids: new Set(ids), span, key: Date.now() });
    if (first === null) return;
    turnRefs.current.get(first)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const off = facts?.turns[first]?.audioOffset;
    if (isVoice && audioRef.current && typeof off === "number") {
      audioRef.current.currentTime = Math.max(0, off - 1);
      audioRef.current.play().catch(() => {});
    }
  }

  if (!id) return <div className="text-slate-500">Не указан диалог.</div>;
  if (!data) return <div className="p-8 text-slate-500">{error ? <ErrorNote error={error} /> : <><Spinner /> Загрузка…</>}</div>;

  const { dialogue, evaluation: ev, history } = data;
  const internal = new Set(facts?.turns.filter((t) => t.internal).map((t) => t.idx));
  const longWaitStart = new Map((facts?.longWaits ?? []).map((g) => [g.toIdx ?? -1, g]));
  const critById = new Map((ev?.checklist.criteria ?? []).map((c) => [c.id, c]));

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-800">← Диалоги</Link>
        <h1 className="font-mono text-lg font-semibold">{dialogue.conversation_id}</h1>
        <Badge>{dialogue.language}</Badge>
        <Badge tone="blue">{isVoice ? "📞 звонок" : "💬 чат"}</Badge>
        <span className="text-xs text-slate-500">
          {dialogue.transcript.length} реплик · {formatClock(facts?.durationSec ?? 0)} · первая реакция {facts?.firstReactionSec ?? "—"} с
        </span>
        <div className="ml-auto flex items-center gap-2">
          {history.length > 1 && (
            <select className={cx(inputCls, "w-auto! text-xs")} value={ev?.id ?? ""} onChange={(e) => load(e.target.value)}>
              {history.map((h: any) => (
                <option key={h.id} value={h.id} disabled={h.status !== "done"}>
                  {fmtTime(h.created_at)} · {h.model} · {h.status === "done" ? h.total ?? "—" : "ошибка"} · чек-лист v{h.checklist_version}
                </option>
              ))}
            </select>
          )}
          <Button variant="primary" onClick={evaluate} disabled={running}>
            {running ? <Spinner /> : "▶"} {ev ? "Переоценить текущим чек-листом" : "Оценить"}
          </Button>
        </div>
      </div>
      <ErrorNote error={error} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* transcript */}
        <Card className="flex max-h-[calc(100vh-150px)] flex-col overflow-hidden">
          {isVoice && dialogue.audio_url && (
            <div className="border-b border-slate-100 p-3">
              {!audioError ? (
                <audio ref={audioRef} controls preload="none" className="w-full" src={audioUrl(dialogue.conversation_id)} onError={() => setAudioError(true)} />
              ) : (
                <div className="text-xs text-slate-500">Встроенный плеер недоступен.</div>
              )}
              <div className="mt-1 flex justify-between text-[11px] text-slate-400">
                <span>Клик по времени реплики или по доказательству — перемотка записи.</span>
                <a href={dialogue.audio_url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                  Открыть в плеере ↗
                </a>
              </div>
            </div>
          )}
          <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
            {dialogue.transcript.map((t, i) => {
              const s = SPEAKER[t.speaker] ?? SPEAKER.system;
              const hl = highlight.ids.has(i);
              const inSpan = highlight.span && i >= highlight.span[0] && i <= highlight.span[1];
              const wait = longWaitStart.get(i);
              const ti = facts?.turns[i];
              return (
                <div key={i}>
                  {wait && (
                    <div className="my-1 text-center text-[11px] font-medium text-amber-700">
                      ⏱ ожидание {wait.seconds} с {wait.warnedBefore ? "(с предупреждением)" : "без предупреждения"}
                    </div>
                  )}
                  <div
                    ref={(el) => {
                      if (el) turnRefs.current.set(i, el);
                    }}
                    key={hl ? `hl-${highlight.key}` : undefined}
                    className={cx(
                      "rounded-lg border px-3 py-1.5 text-sm",
                      s.cls,
                      t.speaker === "client" ? "mr-10" : t.speaker === "operator" ? "ml-10" : "mx-6",
                      internal.has(i) && "opacity-60",
                      inSpan && "ring-2 ring-amber-300",
                      hl && "turn-flash ring-2 ring-amber-500",
                    )}
                  >
                    <div className="mb-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                      <span className="font-mono">#{i + 1}</span>
                      <span className="font-medium text-slate-500">{s.label}</span>
                      <button
                        className={cx("font-mono", isVoice && "text-brand-700 hover:underline")}
                        onClick={() => isVoice && jump([i])}
                        title={t.timestamp}
                      >
                        {formatClock(ti?.t ?? 0)}
                      </button>
                      {internal.has(i) && <Badge tone="slate">внутр. консультация</Badge>}
                      {ti?.duplicate && <Badge tone="slate">дубль</Badge>}
                    </div>
                    <div className="whitespace-pre-wrap">{t.text}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* result */}
        <div className="max-h-[calc(100vh-150px)] space-y-3 overflow-y-auto pr-1">
          {!ev && (
            <Card className="p-6 text-center text-slate-500">
              Диалог ещё не оценён. Нажмите «Оценить» — оценка выполняется активным чек-листом.
            </Card>
          )}
          {ev && ev.status === "error" && <ErrorNote error={`Ошибка оценки: ${ev.error}`} />}
          {ev && ev.status === "done" && (
            <>
              <Summary ev={ev} />
              {ev.checklist.sections.map((s) => {
                const crits = ev.checklist.criteria.filter((c) => c.sectionId === s.id);
                if (!crits.length) return null;
                return (
                  <div key={s.id} className="space-y-2">
                    <div className="flex items-baseline justify-between px-1">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s.title}</h3>
                    </div>
                    {crits.map((c) => (
                      <CriterionRow
                        key={c.id}
                        c={c}
                        ev={ev}
                        onJump={jump}
                        onAppeal={() => setAppealFor(c)}
                        transcriptLen={dialogue.transcript.length}
                      />
                    ))}
                  </div>
                );
              })}
              <div className="px-1 text-[11px] text-slate-400">
                Модель {ev.provider}/{ev.model} · голосов {ev.samples} · {fmtTime(ev.createdAt)} · чек-лист «{ev.checklist.name}» v{ev.checklist.version} ·{" "}
                {ev.usage.inputTokens + ev.usage.cacheReadTokens} вх. / {ev.usage.outputTokens} вых. токенов
                {ev.costUsd !== null ? ` · $${ev.costUsd.toFixed(4)}` : ""} · {(ev.latencyMs / 1000).toFixed(1)} с
              </div>
              <Journal key={ev.id} ev={ev} />
            </>
          )}
        </div>
      </div>

      <AppealModal
        criterion={appealFor}
        evaluationId={ev?.id ?? ""}
        onClose={() => setAppealFor(null)}
        onSaved={() => {
          setAppealFor(null);
          load(ev?.id);
        }}
      />
    </div>
  );
}

type RawVote = {
  provider: string;
  model: string;
  ok: boolean;
  invalidFirst: boolean;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  costUsd: number | null;
  error?: string;
};
type RawLog = {
  votes?: RawVote[];
  responses?: { voter: string; attempt: number; model?: string; responseId?: string | null; receivedAt?: string; json: unknown }[];
  prompt?: { system: string; user: string };
};

/** Shows what this evaluation actually sent and received, so a result can be traced to a live model call. */
function Journal({ ev }: { ev: FullEval }) {
  const [log, setLog] = useState<RawLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pre = "mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 p-3 text-xs text-slate-100";
  return (
    <details
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !log && !error) {
          api<{ raw: RawLog | null }>(`/api/evaluations/${ev.id}?raw=1`)
            .then((r) => setLog(r.raw ?? {}))
            .catch((err) => setError(err.message));
        }
      }}
    >
      <summary className="cursor-pointer font-medium text-slate-700">Журнал оценки: запрос и ответ модели</summary>
      <p className="mt-2 text-xs text-slate-500">Здесь данные показаны как есть: в запросе и ответе модели реплики считаются с 0, в карточке и в файле результатов с 1.</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        {[
          ["Время", fmtTime(ev.createdAt)],
          ["Модель", `${ev.provider}/${ev.model}`],
          ["Версия промпта", ev.promptVersion ?? "не записана"],
          ["Глубина рассуждений", ev.reasoning ?? "не записана"],
          ["Чек-лист", `${ev.checklist.id} v${ev.checklist.version}`],
          ["Голосов", String(ev.samples)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-mono break-words text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      <ErrorNote error={error} />
      {!log && !error && <div className="mt-3 text-xs text-slate-500"><Spinner /> Загрузка…</div>}
      {log && (
        <div className="mt-3 space-y-3">
          {!!log.votes?.length && (
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 font-medium">Голос</th>
                  <th className="py-1 font-medium">Статус</th>
                  <th className="py-1 text-right font-medium">Токены вх./вых.</th>
                  <th className="py-1 text-right font-medium">Цена</th>
                  <th className="py-1 text-right font-medium">Время</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {log.votes.map((v, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1 font-mono">{i + 1}. {v.provider}/{v.model}</td>
                    <td className="py-1">{v.ok ? (v.invalidFirst ? "ответ получен со второй попытки" : "ответ получен") : `ошибка: ${v.error ?? ""}`}</td>
                    <td className="py-1 text-right">{v.usage.inputTokens + v.usage.cacheReadTokens} / {v.usage.outputTokens}</td>
                    <td className="py-1 text-right">{v.costUsd === null ? "—" : `$${v.costUsd.toFixed(4)}`}</td>
                    <td className="py-1 text-right">{(v.latencyMs / 1000).toFixed(1)} с</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(log.responses ?? []).map((r, i) => (
            <div key={i}>
              <div className="text-xs text-slate-500">
                Ответ {i + 1}: {r.model ?? r.voter}
                {r.responseId && <> · id <span className="font-mono">{r.responseId}</span></>}
                {r.receivedAt && <> · {fmtTime(r.receivedAt)}</>}
              </div>
              <pre className={pre}>{JSON.stringify(r.json, null, 1)}</pre>
            </div>
          ))}
          {log.prompt ? (
            <>
              <div>
                <div className="text-xs text-slate-500">Системный промпт, собранный из чек-листа</div>
                <pre className={pre}>{log.prompt.system}</pre>
              </div>
              <div>
                <div className="text-xs text-slate-500">Сообщение с диалогом и фактами</div>
                <pre className={pre}>{log.prompt.user}</pre>
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-500">Текст промпта не сохранён: оценка сделана до появления журнала.</div>
          )}
        </div>
      )}
    </details>
  );
}

function Summary({ ev }: { ev: FullEval }) {
  const changed = ev.finalScore.total !== ev.score.total;
  const grossC = ev.checklist.criteria.filter((c) => ev.finalScore.grossCriteria.includes(c.id));
  const grossJ = ev.finalJudgments.filter((j) => ev.finalScore.grossCriteria.includes(j.criterionId));
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-6">
        <div>
          <div className="text-xs text-slate-500">{changed ? "Итог после апелляций" : "Итоговый балл"}</div>
          <div className={cx("text-4xl font-bold tabular-nums", totalTone(ev.finalScore.total))}>
            {ev.finalScore.total ?? "—"}
            <span className="text-base font-normal text-slate-400"> / 100</span>
          </div>
          {changed && <div className="text-xs text-slate-500">исходная оценка: <span className="line-through">{ev.score.total ?? "—"}</span></div>}
          {ev.finalScore.total === null && <div className="text-xs text-slate-500">нет применимых критериев с весом — итог не рассчитывается</div>}
        </div>
        <div className="grid flex-1 grid-cols-1 gap-1.5 sm:grid-cols-2">
          {ev.finalScore.sections
            .filter((s) => s.maxPoints > 0 || s.hasApplicable)
            .map((s) => (
              <div key={s.sectionId} className="rounded-lg bg-slate-50 px-3 py-1.5">
                <div className="truncate text-[11px] text-slate-500">{s.title}</div>
                <div className="text-sm font-semibold tabular-nums">
                  {fmtPoints(s.points)} <span className="font-normal text-slate-400">/ {fmtPoints(s.maxPoints)}</span>
                </div>
              </div>
            ))}
        </div>
      </div>
      {ev.finalScore.grossError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          ⚠ <b>Грубая ошибка</b> ({grossC.map((c) => c.title).join(", ")}): {grossJ.map((j) => shiftTurnRefs(j.explanation)).join(" ")}
          <div className="text-xs text-red-600">Отмечается отдельно, баллы по критериям не меняет.</div>
        </div>
      )}
    </Card>
  );
}

function CriterionRow({
  c, ev, onJump, onAppeal, transcriptLen,
}: {
  c: Criterion; ev: FullEval; onJump: (ids: number[], span?: [number, number] | null) => void; onAppeal: () => void; transcriptLen: number;
}) {
  const orig = ev.judgments.find((j) => j.criterionId === c.id);
  const fin = ev.finalJudgments.find((j) => j.criterionId === c.id);
  const sc = ev.finalScore.criteria.find((x) => x.criterionId === c.id);
  const appeal = ev.appeals.find((a) => a.criterionId === c.id);
  if (!orig || !fin) {
    return (
      <Card className="p-3 text-sm text-slate-500">
        {c.code}. {c.title} — нет ответа модели (критерий добавлен после этой оценки?)
      </Card>
    );
  }
  const changed = String(orig.answer) !== String(fin.answer);
  return (
    <Card className={cx("p-3", c.isFlag && fin.answer === "yes" && "border-red-300")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-400">{c.code}</span>
        <span className="font-medium">{c.title}</span>
        <Badge tone={answerTone(c, fin.answer)}>{fmtAnswer(c, fin.answer)}</Badge>
        {changed && (
          <span className="text-xs text-slate-500">
            было <span className="line-through">{fmtAnswer(c, orig.answer)}</span>
          </span>
        )}
        {fin.confidence === "low" && (
          <Badge tone="amber" title="Независимые прогоны модели разошлись — рекомендуется ручная проверка">
            голоса: {fin.votes.map((v) => fmtAnswer(c, v)).join(" / ")}
          </Badge>
        )}
        <span className="ml-auto text-sm tabular-nums text-slate-600">
          {c.isFlag ? (
            <span className="text-xs text-slate-400">без баллов</span>
          ) : sc?.applicable ? (
            <>
              <b>{fmtPoints(sc.points)}</b> / {fmtPoints(sc.maxPoints)}
              <span className="ml-1 text-xs text-slate-400">(вес {c.weight})</span>
            </>
          ) : (
            <span className="text-xs text-slate-400">исключён · вес {c.weight} перераспределён</span>
          )}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-slate-700">{shiftTurnRefs(orig.explanation)}</p>
      {fin.answer === "na" && orig.naReason && <p className="mt-1 text-xs text-slate-500">Причина N/A: {orig.naReason}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {orig.evidenceTurnIds.map((t) => (
          <button key={t} onClick={() => onJump([t])} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700 hover:bg-amber-100">
            #{t + 1}
          </button>
        ))}
        {orig.checkedSpan && (
          <button
            onClick={() => onJump([], orig.checkedSpan)}
            className="rounded-md border border-dashed border-amber-400 px-1.5 py-0.5 text-xs text-amber-800 hover:bg-amber-50"
            title="Проверенный участок, где ожидалось действие"
          >
            проверено #{orig.checkedSpan[0] + 1}–#{Math.min(orig.checkedSpan[1], transcriptLen - 1) + 1}
          </button>
        )}
        <span className="ml-auto">
          {appeal ? (
            <AppealStatus appeal={appeal} c={c} />
          ) : (
            <Button size="sm" variant="ghost" onClick={onAppeal}>
              Оспорить
            </Button>
          )}
        </span>
      </div>
    </Card>
  );
}

function AppealStatus({ appeal, c }: { appeal: Appeal; c: Criterion }) {
  if (appeal.status === "open")
    return (
      <Link href="/appeals/" className="text-xs">
        <Badge tone="violet">апелляция на рассмотрении</Badge>
      </Link>
    );
  return (
    <span className="text-xs text-slate-600" title={`Комментарий: ${appeal.comment}\nПричина решения: ${appeal.review?.reason}`}>
      <Badge tone={appeal.status === "changed" ? "blue" : "slate"}>
        {appeal.status === "changed" ? `изменено → ${fmtAnswer(c, appeal.review!.newAnswer!)}` : "оценка подтверждена"}
      </Badge>{" "}
      {appeal.review?.reason}
    </span>
  );
}

function AppealModal({ criterion, evaluationId, onClose, onSaved }: { criterion: Criterion | null; evaluationId: string; onClose: () => void; onSaved: () => void }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setComment("");
    setError(null);
  }, [criterion]);
  return (
    <Modal open={!!criterion} onClose={onClose} title={`Апелляция: ${criterion?.code}. ${criterion?.title}`}>
      <p className="mb-2 text-sm text-slate-600">Опишите, почему оценка по критерию неверна. Проверяющий увидит спорную оценку, ваш комментарий и фрагмент диалога.</p>
      <textarea className={cx(inputCls, "h-28")} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: оператор представился во второй реплике, см. #10" autoFocus />
      <ErrorNote error={error} />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button
          variant="primary"
          disabled={!comment.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/api/appeals", { method: "POST", json: { evaluationId, criterionId: criterion!.id, comment } });
              onSaved();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner />} Подать апелляцию
        </Button>
      </div>
    </Modal>
  );
}
