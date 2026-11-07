"use client";

import { useEffect, useState } from "react";
import { api } from "@/ui/api";
import { Badge, Card, ErrorNote, Spinner, cx, inputCls } from "@/ui/kit";
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

  if (!r) return <div className="p-8 text-slate-500">{error ? <ErrorNote error={error} /> : <><Spinner /> Загрузка…</>}</div>;
  const rows = [...(r.data?.candidates ?? [])].sort((a, b) => b.agreement - a.agreement);
  const smoke = r.data?.meta.split === "smoke";
  const axisMin = Math.max(0, Math.floor((Math.min(...rows.map((x) => x.ci[0]), 1) - 0.05) * 20) / 20);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-lg font-semibold">Сравнение моделей оценки</h1>
          <p className="text-sm text-slate-500">
            Один и тот же промпт и чек-лист для всех моделей; согласие с ручной разметкой DEV. Модель выбирается по измерению, а не по вендору.
          </p>
        </div>
        {r.files.length > 0 && (
          <select className={cx(inputCls, "ml-auto w-auto")} value={r.file ?? ""} onChange={(e) => setFile(e.target.value)}>
            {r.files.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        )}
      </div>

      {!r.data && (
        <Card className="p-6 text-sm text-slate-600">
          Бенчмарк ещё не запускался. После ручной разметки выполните:
          <pre className="mt-2 rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`npm run bench -- --smoke            # проверить адаптеры (3 диалога)
npm run bench -- --split train       # шорт-лист на обучающей части
npm run bench -- --split test --n3 "<лучшие две>" --ensemble "<по одной от вендора>"
npm run compare -- benchmarks/<файл>.json --apply`}</pre>
        </Card>
      )}

      {r.data && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge tone={smoke ? "amber" : "blue"}>{smoke ? "smoke — только проверка адаптеров" : `выборка: ${r.data.meta.split}`}</Badge>
            <span>{r.data.meta.dialogues} диалогов · размечено {r.data.meta.labelled}</span>
            <span>· промпт {r.data.meta.promptVersion} · {r.data.meta.checklist} · reasoning {r.data.meta.reasoning}</span>
            <span>· {new Date(r.data.meta.createdAt).toLocaleString("ru-RU")}</span>
            {r.data.meta.skipped?.length > 0 && <span className="text-amber-700">· пропущены (нет ключа): {r.data.meta.skipped.join(", ")}</span>}
            {!smoke && (
              <label className="ml-auto flex items-center gap-1">
                лимит $/диалог
                <input className={cx(inputCls, "w-20 py-0.5")} placeholder={String(r.cap)} value={cap} onChange={(e) => setCap(e.target.value)} />
              </label>
            )}
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
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
              <tbody className="divide-y divide-slate-100">
                {rows.map((x) => {
                  const win = r.decision?.winner === x.candidate;
                  const fb = r.decision?.fallback === x.candidate;
                  const ex = r.decision?.excluded.find((e) => e.candidate === x.candidate);
                  const tied = r.decision?.tied.includes(x.candidate);
                  const pos = (v: number) => `${((v - axisMin) / (1 - axisMin)) * 100}%`;
                  return (
                    <tr key={x.candidate} className={cx(win && "bg-brand-50", ex && "text-slate-400")}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {win && <Badge tone="green">★ выбрана</Badge>}
                          {fb && <Badge tone="blue">резерв</Badge>}
                          <span className="font-mono text-xs">{x.candidate}</span>
                        </div>
                        {ex && <div className="text-[11px] text-red-600">исключена: {ex.reason}</div>}
                        {!ex && tied && !win && <div className="text-[11px] text-slate-500">в пределах ДИ лидера</div>}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={x.tier === "local" ? "violet" : "slate"}>{TIER[x.tier] ?? x.tier}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        {smoke ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="w-12 text-right font-semibold tabular-nums">{pct(x.agreement)}</span>
                            <div className="relative h-2 w-40 rounded-full bg-slate-100">
                              <div className="absolute h-2 rounded-full bg-brand-100" style={{ left: pos(x.ci[0]), width: `calc(${pos(x.ci[1])} - ${pos(x.ci[0])})` }} />
                              <div className="absolute -top-0.5 h-3 w-0.5 bg-brand-700" style={{ left: pos(x.agreement) }} />
                            </div>
                            <span className="text-[11px] tabular-nums text-slate-400">
                              {pct(x.ci[0])}–{pct(x.ci[1])}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{smoke ? "—" : pct(x.kzAgreement)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{x.totalMAE === null ? "—" : x.totalMAE.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {x.gross.recall === null ? "—" : `${pct(x.gross.recall)}${x.gross.fp ? ` · ${x.gross.fp} ложн.` : ""}`}
                      </td>
                      <td className={cx("px-3 py-2 text-right tabular-nums", x.invalidRate >= 0.05 && "text-red-600")}>
                        {pct(x.invalidRate)}
                        {x.failRate > 0 && <div className="text-[11px] text-red-600">сбои {pct(x.failRate)}</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{usd(x.costPerDialogue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs">
                        {x.latencyP50 === null ? "—" : `${(x.latencyP50 / 1000).toFixed(1)} / ${((x.latencyP95 ?? 0) / 1000).toFixed(1)} с`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          {r.decision && (
            <Card className="p-4 text-sm">
              <div className="font-medium">
                Решение: {r.decision.winner ? <span className="font-mono">{r.decision.winner}</span> : "ни одна модель не прошла гейты"}
                {r.decision.fallback && (
                  <span className="text-slate-500">
                    {" "}· резерв другого вендора: <span className="font-mono">{r.decision.fallback}</span>
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-slate-500">Правило: {r.decision.rule}</div>
            </Card>
          )}
        </>
      )}

      <Card className="p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Реестр моделей и цены</span>
          <span className="text-xs text-slate-500">
            · сейчас используется <span className="font-mono">{r.settings.provider}/{r.settings.model}</span> ({r.settings.source})
          </span>
        </div>
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Модель</th>
              <th>Уровень</th>
              <th className="text-right">Вход / кэш / выход, $ за 1M</th>
              <th className="pl-4">Проверено</th>
              <th>Источник</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {r.registry.models.map((m) => (
              <tr key={`${m.provider}/${m.model}`}>
                <td className="py-1 font-mono">
                  {m.provider}/{m.model}
                  {r.registry.default?.model === m.model && r.registry.default?.provider === m.provider && <Badge tone="green">по умолчанию</Badge>}
                </td>
                <td>{TIER[m.tier] ?? m.tier}</td>
                <td className="text-right tabular-nums">{m.price ? `${m.price.in} / ${m.price.cachedIn ?? "—"} / ${m.price.out}` : "—"}</td>
                <td className="pl-4">
                  {m.checkedAt ?? "—"}
                  {m.priceNote && <span className="ml-1 text-amber-700" title={m.priceNote}>ⓘ</span>}
                </td>
                <td className="max-w-48 truncate">
                  {m.priceSource?.startsWith("http") ? (
                    <a className="text-brand-700 hover:underline" href={m.priceSource} target="_blank" rel="noreferrer">
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
      </Card>
    </div>
  );
}
