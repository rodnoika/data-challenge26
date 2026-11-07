"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/ui/api";
import { Badge, Button, Card, Empty, ErrorNote, Lang, Loading, PageTitle, SectionLabel, Segmented, Spinner, cx, inputCls } from "@/ui/kit";
import { answerTone, fmtAnswer, fmtTime, totalTone } from "@/ui/format";
import { allowedAnswers } from "@/core/scoring";
import { shiftTurnRefs } from "@/core/submission";
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
    <div className="space-y-3">
      <PageTitle
        sub="Спорная оценка, комментарий апелляции и фрагмент диалога. Решение сразу пересчитывает итог."
        aside={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "open", label: "На рассмотрении" },
              { value: "all", label: "Все" },
            ]}
          />
        }
      >
        Апелляции — рабочее место проверяющего
      </PageTitle>
      <ErrorNote error={error} />
      {!items && <Loading />}
      {items && !items.length && <Empty>Апелляций нет. Оспорить оценку можно в карточке диалога.</Empty>}
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

  const open = appeal.status === "open" && !result;
  return (
    <Card className={cx(open && "shadow-[inset_3px_0_0_var(--color-appeal)]")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-rule-soft px-4 py-2">
        <Link href={`/dialogue/?id=${encodeURIComponent(appeal.dialogueId)}`} className="font-mono text-sm text-accent hover:underline">
          {appeal.dialogueId}
        </Link>
        {dialogue && <Lang code={dialogue.language} />}
        <span className="mx-1 h-4 w-px bg-rule" />
        <span className="font-mono text-xs text-ink-3">{c?.code}</span>
        <span className="font-medium">{c?.title}</span>
        {c && j && <Badge tone={answerTone(c, j.answer)}>спорная оценка: {fmtAnswer(c, j.answer)}</Badge>}
        <span className="figures ml-auto text-xs text-ink-3">подана {fmtTime(appeal.createdAt)}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="space-y-3 px-4 py-3 text-sm lg:border-r lg:border-rule-soft">
          <div>
            <SectionLabel>Обоснование системы</SectionLabel>
            <p className="mt-0.5 text-ink">{j ? shiftTurnRefs(j.explanation) : ""}</p>
            {j?.naReason && <p className="mt-1 text-xs text-ink-3">Причина N/A: {j.naReason}</p>}
          </div>
          <div className="border-l-[3px] border-appeal bg-appeal-soft px-3 py-2">
            <SectionLabel className="!text-appeal">Комментарий апелляции</SectionLabel>
            <p className="mt-0.5 text-ink">{appeal.comment}</p>
          </div>
          <div className="figures text-xs text-ink-3">
            Итог диалога сейчас: <b className={cx("font-mono text-sm font-medium", totalTone(item.finalTotal))}>{item.finalTotal ?? "—"}</b>
            {item.finalTotal !== item.originalTotal && <> (исходный <span className="font-mono">{item.originalTotal ?? "—"}</span>)</>}
          </div>
        </div>
        <div className="border-t border-rule-soft lg:border-t-0">
          <div className="px-4 pt-2.5 pb-1">
            <SectionLabel>Фрагмент диалога</SectionLabel>
          </div>
          <div className="max-h-72 overflow-y-auto pb-2 text-sm">
            {shown.map((i, k) => (
              <div key={i}>
                {k > 0 && shown[k - 1] !== i - 1 && <div className="px-4 font-mono text-xs leading-4 text-ink-4">⋯</div>}
                <div className={cx("grid grid-cols-[2rem_4.25rem_minmax(0,1fr)] gap-x-2 px-4 py-1", focus.has(i) && "bg-mark-soft shadow-[inset_3px_0_0_var(--color-warn)]")}>
                  <span className="font-mono text-2xs leading-5 text-ink-4">#{i + 1}</span>
                  <span className={cx("label-caps pt-[3px] !text-[10px]", dialogue?.transcript[i].speaker === "operator" && "!text-accent")}>{SPEAKER_RU[dialogue?.transcript[i].speaker ?? ""] ?? dialogue?.transcript[i].speaker}</span>
                  <span>{dialogue?.transcript[i].text}</span>
                </div>
              </div>
            ))}
            {!shown.length && <div className="px-4 text-xs text-ink-3">Модель не указала реплик — откройте карточку диалога.</div>}
          </div>
        </div>
      </div>

      {open ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-rule bg-paper/60 px-4 py-2.5">
          <Segmented
            value={decision}
            onChange={setDecision}
            options={[
              { value: "upheld", label: "Подтвердить оценку" },
              { value: "changed", label: "Изменить оценку" },
            ]}
          />
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
          <input className={cx(inputCls, "min-w-0 flex-1 basis-64")} placeholder="Причина решения (обязательно)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="primary" onClick={submit} disabled={busy || !reason.trim() || (decision === "changed" && !newAnswer)}>
            {busy && <Spinner />} Сохранить решение
          </Button>
        </div>
      ) : (
        <div className="border-t border-rule-soft px-4 py-2 text-sm">
          {result ? (
            <span className="figures flex flex-wrap items-center gap-2">
              <Badge tone="green">решение сохранено</Badge>
              Итог пересчитан:
              <span className="font-mono text-ink-3 line-through">{result.before ?? "—"}</span>→
              <b className={cx("font-mono text-base font-medium", totalTone(result.after))}>{result.after ?? "—"}</b>
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-ink-2">
              <Badge tone={appeal.status === "changed" ? "blue" : "slate"}>
                {appeal.status === "changed" && c ? `изменено → ${fmtAnswer(c, appeal.review!.newAnswer!)}` : "оценка подтверждена"}
              </Badge>
              {appeal.review?.reason}
              <span className="figures text-xs text-ink-3">· {fmtTime(appeal.review?.reviewedAt)}</span>
            </span>
          )}
        </div>
      )}
      {error && (
        <div className="px-4 pb-3">
          <ErrorNote error={error} />
        </div>
      )}
    </Card>
  );
}

const SPEAKER_RU: Record<string, string> = { client: "Клиент", operator: "Оператор", bot: "Бот", system: "Система" };
