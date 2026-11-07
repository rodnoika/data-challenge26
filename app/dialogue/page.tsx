"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, audioUrl } from "@/ui/api";
import { Badge, Button, Card, Channel, ErrorNote, EvidenceChip, GrossMark, Lang, Loading, Modal, Panel, SectionLabel, Spinner, cx, inputCls } from "@/ui/kit";
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
    <Suspense fallback={<Loading />}>
      <DialogueCard />
    </Suspense>
  );
}

// Transcript is a ledger, not chat bubbles: one line per turn, speaker in a fixed gutter.
const SPEAKER: Record<string, { label: string; who: string; row: string }> = {
  client: { label: "Клиент", who: "text-ink-2", row: "" },
  operator: { label: "Оператор", who: "text-accent", row: "bg-accent-soft/45 shadow-[inset_2px_0_0_var(--color-accent)]" },
  bot: { label: "Бот", who: "text-ink-3", row: "text-ink-3" },
  system: { label: "Система", who: "text-ink-4", row: "text-ink-3 italic" },
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

  if (!id) return <div className="text-ink-3">Не указан диалог.</div>;
  if (!data) return error ? <ErrorNote error={error} /> : <Loading />;

  const { dialogue, evaluation: ev, history } = data;
  const internal = new Set(facts?.turns.filter((t) => t.internal).map((t) => t.idx));
  const longWaitStart = new Map((facts?.longWaits ?? []).map((g) => [g.toIdx ?? -1, g]));
  const critById = new Map((ev?.checklist.criteria ?? []).map((c) => [c.id, c]));

  return (
    <div className="space-y-3">
      {/* header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule pb-2">
        <Link href="/" className="text-sm text-ink-3 hover:text-ink">← Диалоги</Link>
        <span className="h-4 w-px bg-rule" />
        <h1 className="font-mono text-base font-medium">{dialogue.conversation_id}</h1>
        <Lang code={dialogue.language} />
        <span className="text-xs"><Channel voice={isVoice} /></span>
        <span className="figures text-xs text-ink-3">
          {dialogue.transcript.length} реплик · {formatClock(facts?.durationSec ?? 0)} · первая реакция {facts?.firstReactionSec ?? "—"} с
        </span>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          {history.length > 1 && (
            <select className={cx(inputCls, "w-full text-xs sm:w-auto")} value={ev?.id ?? ""} onChange={(e) => load(e.target.value)} title="История оценок">
              {history.map((h: any) => (
                <option key={h.id} value={h.id} disabled={h.status !== "done"}>
                  {fmtTime(h.created_at)} · {h.model} · {h.status === "done" ? h.total ?? "—" : "ошибка"} · чек-лист v{h.checklist_version}
                </option>
              ))}
            </select>
          )}
          <Button variant="primary" onClick={evaluate} disabled={running}>
            {running && <Spinner />} {ev ? "Переоценить текущим чек-листом" : "Оценить"}
          </Button>
        </div>
      </div>
      <ErrorNote error={error} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* transcript */}
        <Card className="flex max-h-[65vh] flex-col overflow-hidden lg:max-h-[calc(100vh-128px)]">
          <div className="flex items-center gap-3 border-b border-rule-soft px-3 py-1.5">
            <SectionLabel>Транскрипт</SectionLabel>
            <span className="ml-auto text-2xs text-ink-3">клик по #реплике в результате — переход{isVoice ? " и перемотка" : ""}</span>
          </div>
          {isVoice && dialogue.audio_url && (
            <div className="border-b border-rule bg-paper px-3 py-2">
              {!audioError ? (
                <audio ref={audioRef} controls preload="none" className="w-full" src={audioUrl(dialogue.conversation_id)} onError={() => setAudioError(true)} />
              ) : (
                <div className="text-xs text-ink-3">Встроенный плеер недоступен.</div>
              )}
              <div className="mt-1 flex justify-between gap-3 text-2xs text-ink-3">
                <span>Клик по времени реплики или по доказательству — перемотка записи.</span>
                <a href={dialogue.audio_url} target="_blank" rel="noreferrer" className="shrink-0 text-accent hover:underline">
                  Открыть в плеере ↗
                </a>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto py-1">
            {dialogue.transcript.map((t, i) => {
              const s = SPEAKER[t.speaker] ?? SPEAKER.system;
              const hl = highlight.ids.has(i);
              const inSpan = highlight.span && i >= highlight.span[0] && i <= highlight.span[1];
              const wait = longWaitStart.get(i);
              const ti = facts?.turns[i];
              return (
                <div key={i}>
                  {wait && (
                    <div className="mx-3 my-1 flex items-center gap-2 text-2xs font-medium text-warn">
                      <span className="h-px flex-1 border-t border-dashed border-warn/50" />
                      ожидание {wait.seconds} с {wait.warnedBefore ? "(с предупреждением)" : "без предупреждения"}
                      <span className="h-px flex-1 border-t border-dashed border-warn/50" />
                    </div>
                  )}
                  <div
                    ref={(el) => {
                      if (el) turnRefs.current.set(i, el);
                    }}
                    key={hl ? `hl-${highlight.key}` : undefined}
                    className={cx(
                      "grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2 border-b border-rule-soft/70 px-3 py-1.5 text-sm sm:grid-cols-[2.25rem_4.5rem_minmax(0,1fr)]",
                      s.row,
                      internal.has(i) && "opacity-55",
                      inSpan && !hl && "bg-mark-soft shadow-[inset_2px_0_0_var(--color-warn)]",
                      hl && "turn-flash bg-mark-soft shadow-[inset_3px_0_0_var(--color-warn)]",
                    )}
                  >
                    <div className="pt-px font-mono text-2xs leading-5 text-ink-4">
                      #{i + 1}
                      <button
                        className={cx("block font-mono", isVoice ? "text-accent hover:underline" : "cursor-default")}
                        onClick={() => isVoice && jump([i])}
                        title={t.timestamp}
                      >
                        {formatClock(ti?.t ?? 0)}
                      </button>
                    </div>
                    <div className={cx("label-caps pt-0.5 !text-[10px] sm:pt-[3px]", s.who)}>
                      {s.label}
                      {internal.has(i) && <div className="mt-0.5 font-normal normal-case tracking-normal text-ink-3">внутр. консультация</div>}
                      {ti?.duplicate && <div className="mt-0.5 font-normal normal-case tracking-normal text-ink-3">дубль</div>}
                    </div>
                    <div className="col-start-2 whitespace-pre-wrap sm:col-start-3 sm:row-start-1">{t.text}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* result */}
        <div className="space-y-3 lg:max-h-[calc(100vh-128px)] lg:overflow-y-auto lg:pr-1">
          {!ev && (
            <Card className="px-4 py-10 text-center text-sm text-ink-3">
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
                const sec = ev.finalScore.sections.find((x) => x.sectionId === s.id);
                return (
                  <Panel
                    key={s.id}
                    title={s.title}
                    aside={sec && sec.maxPoints > 0 ? <span className="figures font-mono text-ink-2">{fmtPoints(sec.points)} / {fmtPoints(sec.maxPoints)}</span> : undefined}
                  >
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
                  </Panel>
                );
              })}
              <div className="figures px-1 font-mono text-2xs leading-4 text-ink-3">
                {ev.provider}/{ev.model} · голосов {ev.samples} · {fmtTime(ev.createdAt)} · чек-лист «{ev.checklist.name}» v{ev.checklist.version} ·{" "}
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
  const pre = "mt-1 max-h-72 overflow-auto border border-rule bg-paper p-3 font-mono text-xs break-words whitespace-pre-wrap text-ink-2";
  return (
    <details
      className="border border-rule bg-sheet px-3 py-2 text-sm"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !log && !error) {
          api<{ raw: RawLog | null }>(`/api/evaluations/${ev.id}?raw=1`)
            .then((r) => setLog(r.raw ?? {}))
            .catch((err) => setError(err.message));
        }
      }}
    >
      <summary className="label-caps cursor-pointer">Журнал оценки: запрос и ответ модели</summary>
      <p className="mt-2 text-xs text-ink-3">Здесь данные показаны как есть: в запросе и ответе модели реплики считаются с 0, в карточке и в файле результатов с 1.</p>
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
            <dt className="text-ink-3">{k}</dt>
            <dd className="font-mono break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <ErrorNote error={error} />
      {!log && !error && <div className="mt-3 text-xs text-ink-3"><Spinner /> Загрузка…</div>}
      {log && (
        <div className="mt-3 space-y-3">
          {!!log.votes?.length && (
            <table className="w-full text-left text-xs">
              <thead className="text-ink-3">
                <tr>
                  <th className="py-1 font-medium">Голос</th>
                  <th className="py-1 font-medium">Статус</th>
                  <th className="py-1 text-right font-medium">Токены вх./вых.</th>
                  <th className="py-1 text-right font-medium">Цена</th>
                  <th className="py-1 text-right font-medium">Время</th>
                </tr>
              </thead>
              <tbody className="figures">
                {log.votes.map((v, i) => (
                  <tr key={i} className="border-t border-rule-soft">
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
              <div className="text-xs text-ink-3">
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
                <div className="text-xs text-ink-3">Системный промпт, собранный из чек-листа</div>
                <pre className={pre}>{log.prompt.system}</pre>
              </div>
              <div>
                <div className="text-xs text-ink-3">Сообщение с диалогом и фактами</div>
                <pre className={pre}>{log.prompt.user}</pre>
              </div>
            </>
          ) : (
            <div className="text-xs text-ink-3">Текст промпта не сохранён: оценка сделана до появления журнала.</div>
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
  const secs = ev.finalScore.sections.filter((s) => s.maxPoints > 0 || s.hasApplicable);
  return (
    <Card>
      <div className="flex flex-wrap items-stretch">
        <div className="min-w-44 border-r border-rule-soft px-4 py-3">
          <SectionLabel>{changed ? "Итог после апелляций" : "Итоговый балл"}</SectionLabel>
          <div className={cx("figures mt-1 font-mono text-[40px] leading-none font-medium tracking-tight", totalTone(ev.finalScore.total))}>
            {ev.finalScore.total ?? "—"}
            <span className="ml-1 text-sm font-normal tracking-normal text-ink-4">/ 100</span>
          </div>
          {changed && (
            <div className="figures mt-1.5 text-xs text-ink-3">
              исходная оценка: <span className="font-mono line-through">{ev.score.total ?? "—"}</span>
            </div>
          )}
          {ev.finalScore.total === null && <div className="mt-1.5 max-w-52 text-xs text-ink-3">нет применимых критериев с весом — итог не рассчитывается</div>}
        </div>
        <table className="figures min-w-60 flex-1 self-center text-sm">
          <tbody>
            {secs.map((s) => (
              <tr key={s.sectionId} className="border-b border-rule-soft last:border-b-0">
                <td className="max-w-0 truncate py-1 pr-2 pl-4 text-ink-2" title={s.title}>{s.title}</td>
                <td className="w-24 py-1">
                  <div className="h-1 bg-shade">
                    <div className="h-full bg-accent" style={{ width: `${s.maxPoints ? (s.points / s.maxPoints) * 100 : 0}%` }} />
                  </div>
                </td>
                <td className="w-24 py-1 pr-4 pl-3 text-right font-mono text-xs whitespace-nowrap">
                  {fmtPoints(s.points)} <span className="text-ink-4">/ {fmtPoints(s.maxPoints)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ev.finalScore.grossError && (
        <div className="border-t border-fail/30 border-l-[3px] border-l-fail bg-fail-soft px-3 py-2 text-sm text-ink">
          <div className="flex flex-wrap items-center gap-2">
            <GrossMark />
            <span className="font-medium text-fail">{grossC.map((c) => c.title).join(", ")}</span>
          </div>
          <p className="mt-1">{grossJ.map((j) => shiftTurnRefs(j.explanation)).join(" ")}</p>
          <div className="mt-0.5 text-xs text-ink-3">Отмечается отдельно, баллы по критериям не меняет.</div>
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
      <div className="border-b border-rule-soft px-3 py-2 text-sm text-ink-3 last:border-b-0">
        <span className="mr-2 font-mono text-xs">{c.code}</span>
        {c.title} — нет ответа модели (критерий добавлен после этой оценки?)
      </div>
    );
  }
  const changed = String(orig.answer) !== String(fin.answer);
  const raised = c.isFlag && fin.answer === "yes";
  return (
    <div className={cx("border-b border-rule-soft px-3 py-2.5 last:border-b-0", raised && "bg-fail-soft/60 shadow-[inset_3px_0_0_var(--color-fail)]")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-5 font-mono text-xs text-ink-3">{c.code}</span>
        <span className="font-medium">{c.title}</span>
        <Badge tone={answerTone(c, fin.answer)}>{fmtAnswer(c, fin.answer)}</Badge>
        {changed && (
          <span className="text-xs text-ink-3">
            было <span className="line-through">{fmtAnswer(c, orig.answer)}</span>
          </span>
        )}
        {fin.confidence === "low" && (
          <Badge tone="amber" title="Независимые прогоны модели разошлись — рекомендуется ручная проверка">
            голоса: {fin.votes.map((v) => fmtAnswer(c, v)).join(" / ")}
          </Badge>
        )}
        <span className="figures ml-auto text-right text-sm">
          {c.isFlag ? (
            <span className="text-xs text-ink-3">без баллов</span>
          ) : sc?.applicable ? (
            <span className="font-mono">
              <b className="font-medium">{fmtPoints(sc.points)}</b>
              <span className="text-ink-4"> / {fmtPoints(sc.maxPoints)}</span>
              <span className="ml-2 font-sans text-2xs text-ink-3">вес {c.weight}</span>
            </span>
          ) : (
            <span className="text-xs text-ink-3">исключён · вес {c.weight} перераспределён</span>
          )}
        </span>
      </div>
      <p className="mt-1 pl-7 text-sm text-ink-2">{shiftTurnRefs(orig.explanation)}</p>
      {fin.answer === "na" && orig.naReason && <p className="mt-0.5 pl-7 text-xs text-ink-3">Причина N/A: {orig.naReason}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-7">
        {orig.evidenceTurnIds.length > 0 && <span className="mr-0.5 text-2xs text-ink-3">доказательства</span>}
        {orig.evidenceTurnIds.map((t) => (
          <EvidenceChip key={t} n={t + 1} onClick={() => onJump([t])} />
        ))}
        {orig.checkedSpan && (
          <button
            onClick={() => onJump([], orig.checkedSpan)}
            className="h-5 border border-dashed border-warn/70 px-1.5 font-mono text-xs text-warn hover:bg-mark-soft"
            title="Проверенный участок, где ожидалось действие"
          >
            <span className="font-sans">проверено</span> #{orig.checkedSpan[0] + 1}–#{Math.min(orig.checkedSpan[1], transcriptLen - 1) + 1}
          </button>
        )}
        <span className="ml-auto">
          {appeal ? (
            <AppealStatus appeal={appeal} c={c} />
          ) : (
            <Button size="sm" variant="ghost" onClick={onAppeal} className="text-appeal hover:bg-appeal-soft hover:text-appeal">
              Оспорить
            </Button>
          )}
        </span>
      </div>
    </div>
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
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-ink-2" title={`Комментарий: ${appeal.comment}\nПричина решения: ${appeal.review?.reason}`}>
      <Badge tone={appeal.status === "changed" ? "blue" : "slate"}>
        {appeal.status === "changed" ? `изменено → ${fmtAnswer(c, appeal.review!.newAnswer!)}` : "оценка подтверждена"}
      </Badge>
      <span className="max-w-72 truncate">{appeal.review?.reason}</span>
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
      <p className="mb-2 text-sm text-ink-2">Опишите, почему оценка по критерию неверна. Проверяющий увидит спорную оценку, ваш комментарий и фрагмент диалога.</p>
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
