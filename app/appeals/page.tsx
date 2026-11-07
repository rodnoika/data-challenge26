"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/ui/api";
import { Badge, Button, Card, ErrorNote, Spinner, cx, inputCls } from "@/ui/kit";
import { answerTone, fmtAnswer, fmtTime, totalTone } from "@/ui/format";
import { allowedAnswers } from "@/core/scoring";
import type { Appeal, Criterion, Judgment, Turn } from "@/core/types";

type Item = {
  appeal: Appeal;
  criterion: Criterion | null;
  judgment: Judgment | null;
  originalTotal: number | null;
  finalTotal: number | null;
  dialogue: { id: string; language: string; channel: string; transcript: Turn[] } | null;
};

export default function AppealsPage() {
  const [tab, setTab] = useState<"open" | "all">("open");
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api<{ items: Item[] }>(`/api/appeals?status=${tab === "open" ? "open" : "all"}`);
      setItems(r.items);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    setItems(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Апелляции — рабочее место проверяющего</h1>
        <div className="ml-auto flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {(["open", "all"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cx("rounded-md px-3 py-1", tab === t ? "bg-slate-900 text-white" : "text-slate-600")}>
              {t === "open" ? "На рассмотрении" : "Все"}
            </button>
          ))}
        </div>
      </div>
      <ErrorNote error={error} />
      {!items && <div className="text-slate-500"><Spinner /> Загрузка…</div>}
      {items && !items.length && <Card className="p-8 text-center text-slate-500">Апелляций нет. Оспорить оценку можно в карточке диалога.</Card>}
      {items?.map((it) => <AppealCard key={it.appeal.id} item={it} onDone={load} />)}
    </div>
  );
}

function AppealCard({ item, onDone }: { item: Item; onDone: () => void }) {
  const { appeal, criterion: c, judgment: j, dialogue } = item;
  const [decision, setDecision] = useState<"upheld" | "changed">("upheld");
  const [newAnswer, setNewAnswer] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ before: number | null; after: number | null } | null>(null);

  // fragment: evidence turns (+ checked span) with one turn of context on each side
  const focus = new Set<number>([...(j?.evidenceTurnIds ?? [])]);
  if (j?.checkedSpan) for (let i = j.checkedSpan[0]; i <= j.checkedSpan[1]; i++) focus.add(i);
  const show = new Set<number>();
  for (const i of focus) for (let k = i - 1; k <= i + 1; k++) if (dialogue && k >= 0 && k < dialogue.transcript.length) show.add(k);
  const shown = [...show].sort((a, b) => a - b).slice(0, 30);

  const options = c ? allowedAnswers(c).filter((a) => String(a) !== String(j?.answer)) : [];

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ evaluation: { score: { total: number | null }; finalScore: { total: number | null } } }>(`/api/appeals/${appeal.id}/review`, {
        method: "POST",
        json: { decision, newAnswer: decision === "changed" ? newAnswer : null, reason },
      });
      setResult({ before: r.evaluation.score.total, after: r.evaluation.finalScore.total });
      setTimeout(onDone, 2500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/dialogue/?id=${encodeURIComponent(appeal.dialogueId)}`} className="font-mono text-sm text-brand-700 hover:underline">
          {appeal.dialogueId}
        </Link>
        {dialogue && <Badge>{dialogue.language}</Badge>}
        <span className="font-medium">
          {c?.code}. {c?.title}
        </span>
        {c && j && <Badge tone={answerTone(c, j.answer)}>спорная оценка: {fmtAnswer(c, j.answer)}</Badge>}
        <span className="ml-auto text-xs text-slate-500">подана {fmtTime(appeal.createdAt)}</span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2 text-sm">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-500">Обоснование системы</div>
            <div>{j?.explanation}</div>
            {j?.naReason && <div className="mt-1 text-xs text-slate-500">Причина N/A: {j.naReason}</div>}
          </div>
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
            <div className="text-xs font-medium text-violet-700">Комментарий апелляции</div>
            <div>{appeal.comment}</div>
          </div>
          <div className="text-xs text-slate-500">
            Итог диалога сейчас: <b className={totalTone(item.finalTotal)}>{item.finalTotal ?? "—"}</b>
            {item.finalTotal !== item.originalTotal && <> (исходный {item.originalTotal ?? "—"})</>}
          </div>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-sm">
          <div className="px-1 text-xs font-medium text-slate-500">Фрагмент диалога</div>
          {shown.map((i, k) => (
            <div key={i}>
              {k > 0 && shown[k - 1] !== i - 1 && <div className="text-center text-xs text-slate-300">…</div>}
              <div className={cx("rounded px-2 py-1", focus.has(i) ? "bg-amber-50 ring-1 ring-amber-300" : "")}>
                <span className="mr-1 font-mono text-[11px] text-slate-400">#{i}</span>
                <span className="mr-1 text-[11px] font-medium uppercase text-slate-500">{dialogue?.transcript[i].speaker}</span>
                {dialogue?.transcript[i].text}
              </div>
            </div>
          ))}
          {!shown.length && <div className="px-1 text-xs text-slate-400">Модель не указала реплик — откройте карточку диалога.</div>}
        </div>
      </div>

      {appeal.status === "open" && !result ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-sm">
            <button onClick={() => setDecision("upheld")} className={cx("rounded-md px-3 py-1", decision === "upheld" ? "bg-slate-900 text-white" : "text-slate-600")}>
              Подтвердить оценку
            </button>
            <button onClick={() => setDecision("changed")} className={cx("rounded-md px-3 py-1", decision === "changed" ? "bg-slate-900 text-white" : "text-slate-600")}>
              Изменить оценку
            </button>
          </div>
          {decision === "changed" && c && (
            <select className={cx(inputCls, "w-40")} value={newAnswer} onChange={(e) => setNewAnswer(e.target.value)}>
              <option value="">— новая оценка —</option>
              {options.map((a) => (
                <option key={a} value={a}>
                  {fmtAnswer(c, a === "yes" || a === "no" || a === "na" ? a : Number(a))}
                </option>
              ))}
            </select>
          )}
          <input className={cx(inputCls, "min-w-64 flex-1")} placeholder="Причина решения (обязательно)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="primary" onClick={submit} disabled={busy || !reason.trim() || (decision === "changed" && !newAnswer)}>
            {busy && <Spinner />} Сохранить решение
          </Button>
        </div>
      ) : (
        <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
          {result ? (
            <span>
              ✓ Решение сохранено. Итог пересчитан: <span className="line-through">{result.before ?? "—"}</span> →{" "}
              <b className={totalTone(result.after)}>{result.after ?? "—"}</b>
            </span>
          ) : (
            <span className="text-slate-600">
              <Badge tone={appeal.status === "changed" ? "blue" : "slate"}>
                {appeal.status === "changed" && c ? `изменено → ${fmtAnswer(c, appeal.review!.newAnswer!)}` : "оценка подтверждена"}
              </Badge>{" "}
              {appeal.review?.reason} · {fmtTime(appeal.review?.reviewedAt)}
            </span>
          )}
        </div>
      )}
      <ErrorNote error={error} />
    </Card>
  );
}
