"use client";

import { useEffect, useState } from "react";
import { api } from "@/ui/api";
import { Badge, Card, ErrorNote, Loading, PageTitle, Panel, cx, inputCls, rowCls, tableCls, theadCls } from "@/ui/kit";
import { TIER } from "@/ui/SettingsPanel";
import type { CandidateMetrics, Decision } from "@/core/benchmark";

type Resp = {
  files: string[];
  file: string | null;
  data: null | {
    meta: { createdAt: string; split: string; dialogues: number; labelled: number; promptVersion: string; checklist: string; reasoning: string; costCap: number; skipped: string[] };
    candidates: CandidateMetrics[];
  };
  decision: Decision | null;
  cap: number;
  registry: {
    default: { provider: string; model: string; chosenBy: string } | null;
    fallback: { provider: string; model: string; chosenBy: string } | null;
    models: { provider: string; model: string; label: string; tier: string; price: { in: number; cachedIn?: number; out: number } | null; priceNote?: string; priceSource?: string; checkedAt: string | null }[];
  };
  settings: { provider: string; model: string; source: string };
};

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(1)}%`);
const usd = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);

export default function ModelsPage() {
  const [r, setR] = useState<Resp | null>(null);
  const [file, setFile] = useState<string>("");
  const [cap, setCap] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams();
    if (file) q.set("file", file);
    if (cap) q.set("cap", cap);
    api<Resp>(`/api/benchmarks?${q}`).then(setR).catch((e) => setError(e.message));
  }, [file, cap]);

  if (!r) return error ? <ErrorNote error={error} /> : <Loading />;
  const rows = [...(r.data?.candidates ?? [])].sort((a, b) => b.agreement - a.agreement);
  const smoke = r.data?.meta.split === "smoke";
  const axisMin = Math.max(0, Math.floor((Math.min(...rows.map((x) => x.ci[0]), 1) - 0.05) * 20) / 20);

  return (
    <div className="space-y-3">
      <PageTitle
        sub="Один и тот же промпт и чек-лист для всех моделей; согласие с ручной разметкой DEV. Модель выбирается по измерению, а не по вендору."
        aside={
          r.files.length > 0 && (
            <select className={cx(inputCls, "w-auto max-w-full font-mono text-xs")} value={r.file ?? ""} onChange={(e) => setFile(e.target.value)} title="Файл бенчмарка">
              {r.files.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          )
        }
      >
        Сравнение моделей оценки
      </PageTitle>

      {!r.data && (
        <Card className="p-4 text-sm text-ink-2">
          Бенчмарк ещё не запускался. После ручной разметки выполните:
          <pre className="mt-2 overflow-x-auto border border-rule bg-paper p-3 font-mono text-xs text-ink">{`npm run bench -- --smoke            # проверить адаптеры (3 диалога)
npm run bench -- --split train       # шорт-лист на обучающей части
npm run bench -- --split test --n3 "<лучшие две>" --ensemble "<по одной от вендора>"
npm run compare -- benchmarks/<файл>.json --apply`}</pre>
        </Card>
      )}

      {r.data && (
        <>
          <div className="figures flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <Badge tone={smoke ? "amber" : "blue"}>{smoke ? "smoke — только проверка адаптеров" : `выборка: ${r.data.meta.split}`}</Badge>
            <span>{r.data.meta.dialogues} диалогов · размечено {r.data.meta.labelled}</span>
            <span>· промпт {r.data.meta.promptVersion} · {r.data.meta.checklist} · reasoning {r.data.meta.reasoning}</span>
            <span>· {new Date(r.data.meta.createdAt).toLocaleString("ru-RU")}</span>
            {r.data.meta.skipped?.length > 0 && <span className="text-warn">· пропущены (нет ключа): {r.data.meta.skipped.join(", ")}</span>}
            {!smoke && (
              <label className="ml-auto flex items-center gap-1.5 whitespace-nowrap">
                лимит $/диалог
                <input className={cx(inputCls, "w-20 py-0.5 font-mono")} placeholder={String(r.cap)} value={cap} onChange={(e) => setCap(e.target.value)} />
              </label>
            )}
          </div>

          <Card className="overflow-x-auto">
            <table className={cx(tableCls, "figures")}>
              <thead className={theadCls}>
                <tr>
                  <th className="px-3 py-2">Модель</th>
                  <th className="px-3 py-2">Уровень</th>
                  <th className="px-3 py-2">Согласие (95% ДИ)</th>
                  <th className="px-3 py-2 text-right">KZ</th>
                  <th className="px-3 py-2 text-right" title="Средняя абсолютная ошибка итогового балла">MAE итога</th>
                  <th className="px-3 py-2 text-right" title="Доля найденных грубых ошибок">Грубые ошибки</th>
                  <th className="px-3 py-2 text-right" title="Первый ответ не прошёл валидацию схемы">Невалидный вывод</th>
                  <th className="px-3 py-2 text-right">$ / диалог</th>
                  <th className="px-3 py-2 text-right">p50 / p95</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => {
                  const win = r.decision?.winner === x.candidate;
                  const fb = r.decision?.fallback === x.candidate;
                  const ex = r.decision?.excluded.find((e) => e.candidate === x.candidate);
                  const tied = r.decision?.tied.includes(x.candidate);
                  const pos = (v: number) => `${((v - axisMin) / (1 - axisMin)) * 100}%`;
                  return (
                    <tr key={x.candidate} className={cx(rowCls, win && "bg-accent-soft shadow-[inset_3px_0_0_var(--color-accent)] hover:bg-accent-soft", ex && "text-ink-4")}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {win && <Badge tone="blue">выбрана</Badge>}
                          {fb && <Badge tone="blue">резерв</Badge>}
                          <span className="font-mono text-xs">{x.candidate}</span>
                        </div>
                        {ex && <div className="text-2xs text-fail">исключена: {ex.reason}</div>}
                        {!ex && tied && !win && <div className="text-2xs text-ink-3">в пределах ДИ лидера</div>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={x.tier === "local" ? "violet" : "slate"}>{TIER[x.tier] ?? x.tier}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        {smoke ? (
                          <span className="text-xs text-ink-4">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="w-12 text-right font-mono font-medium">{pct(x.agreement)}</span>
                            <div className="relative h-2 w-40 shrink-0 bg-shade">
                              <div className="absolute h-2 bg-accent/25" style={{ left: pos(x.ci[0]), width: `calc(${pos(x.ci[1])} - ${pos(x.ci[0])})` }} />
                              <div className="absolute -top-0.5 h-3 w-0.5 bg-accent-strong" style={{ left: pos(x.agreement) }} />
                            </div>
                            <span className="font-mono text-2xs whitespace-nowrap text-ink-3">
                              {pct(x.ci[0])}–{pct(x.ci[1])}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{smoke ? "—" : pct(x.kzAgreement)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{x.totalMAE === null ? "—" : x.totalMAE.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {x.gross.recall === null ? "—" : `${pct(x.gross.recall)}${x.gross.fp ? ` · ${x.gross.fp} ложн.` : ""}`}
                      </td>
                      <td className={cx("px-3 py-2 text-right font-mono text-xs", x.invalidRate >= 0.05 && "text-fail")}>
                        {pct(x.invalidRate)}
                        {x.failRate > 0 && <div className="text-2xs text-fail">сбои {pct(x.failRate)}</div>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{usd(x.costPerDialogue)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
                        {x.latencyP50 === null ? "—" : `${(x.latencyP50 / 1000).toFixed(1)} / ${((x.latencyP95 ?? 0) / 1000).toFixed(1)} с`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          {r.decision && (
            <Card className="border-l-[3px] border-l-accent px-3 py-2.5 text-sm">
              <div className="font-medium">
                Решение: {r.decision.winner ? <span className="font-mono">{r.decision.winner}</span> : "ни одна модель не прошла гейты"}
                {r.decision.fallback && (
                  <span className="font-normal text-ink-3">
                    {" "}· резерв другого вендора: <span className="font-mono">{r.decision.fallback}</span>
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-ink-3">Правило: {r.decision.rule}</div>
            </Card>
          )}
        </>
      )}

      <Panel
        title="Реестр моделей и цены"
        aside={
          <span>
            сейчас используется <span className="font-mono text-ink-2">{r.settings.provider}/{r.settings.model}</span> ({r.settings.source})
          </span>
        }
        bodyClassName="overflow-x-auto"
      >
        <table className={cx(tableCls, "figures text-xs")}>
          <thead className={theadCls}>
            <tr>
              <th>Модель</th>
              <th>Уровень</th>
              <th className="text-right">Вход / кэш / выход, $ за 1M</th>
              <th>Проверено</th>
              <th>Источник</th>
            </tr>
          </thead>
          <tbody>
            {r.registry.models.map((m) => (
              <tr key={`${m.provider}/${m.model}`} className={rowCls}>
                <td className="h-8 px-3 font-mono whitespace-nowrap">
                  {m.provider}/{m.model}
                  {r.registry.default?.model === m.model && r.registry.default?.provider === m.provider && (
                    <span className="ml-2">
                      <Badge tone="blue">по умолчанию</Badge>
                    </span>
                  )}
                </td>
                <td className="px-3 text-ink-2">{TIER[m.tier] ?? m.tier}</td>
                <td className="px-3 text-right font-mono">{m.price ? `${m.price.in} / ${m.price.cachedIn ?? "—"} / ${m.price.out}` : "—"}</td>
                <td className="px-3 font-mono whitespace-nowrap">
                  {m.checkedAt ?? "—"}
                  {m.priceNote && (
                    <span className="ml-1 cursor-help font-sans text-warn" title={m.priceNote}>
                      прим.
                    </span>
                  )}
                </td>
                <td className="max-w-48 truncate px-3">
                  {m.priceSource?.startsWith("http") ? (
                    <a className="text-accent hover:underline" href={m.priceSource} target="_blank" rel="noreferrer">
                      {new URL(m.priceSource).hostname}
                    </a>
                  ) : (
                    m.priceSource
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
