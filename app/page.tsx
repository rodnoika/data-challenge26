"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, API_BASE } from "@/ui/api";
import { Badge, Button, Card, ErrorNote, Field, inputCls, Spinner, cx } from "@/ui/kit";
import { totalTone } from "@/ui/format";
import type { Checklist } from "@/core/types";
import { SettingsPanel, type SettingsResp } from "@/ui/SettingsPanel";

type Row = {
  id: string;
  groupId: string;
  channel: string;
  language: string;
  hasAudio: boolean;
  turns: number;
  openAppeals: number;
  evaluation: null | {
    id: string;
    status: string;
    total: number | null;
    originalTotal: number | null;
    gross: boolean;
    model: string;
    checklistId: string;
    checklistVersion: number;
    evaluatedAt: string;
    lowConfidence: string[];
    answers: Record<string, string | number>;
    costUsd: number | null;
  };
};
type Job = { id: string; total: number; done: number; failed: number; status: string; errors: string[] };

export default function DialoguesPage() {
  const [groups, setGroups] = useState<{ groupId: string; count: number }[]>([]);
  const [group, setGroup] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState<Checklist | null>(null);
  const [checklists, setChecklists] = useState<{ id: string; name: string; version: number }[]>([]);
  const [fetchId, setFetchId] = useState("DEV");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [evaluating, setEvaluating] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState({ lang: "", channel: "", q: "", status: "" });
  const [settings, setSettings] = useState<SettingsResp | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (g?: string) => {
    const gr = await api<{ groups: { groupId: string; count: number }[] }>("/api/groups");
    setGroups(gr.groups);
    const target = g ?? (group || gr.groups[0]?.groupId || "");
    if (target !== group) setGroup(target);
    const [d, c] = await Promise.all([
      api<{ dialogues: Row[] }>(`/api/dialogues${target ? `?group=${encodeURIComponent(target)}` : ""}`),
      api<{ active: Checklist; checklists: { id: string; name: string; version: number }[] }>("/api/checklists"),
    ]);
    setRows(d.dialogues);
    setActive(c.active);
    setChecklists(c.checklists);
    if (target) {
      const j = await api<{ job: Job | null }>(`/api/batches?group=${encodeURIComponent(target)}`);
      setJob(j.job);
    }
  }, [group]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("cqa.group");
      if (saved) setGroup(saved);
    } catch {}
    api<SettingsResp>("/api/settings").then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    load().catch((e) => setError(String(e.message ?? e)));
    try {
      if (group) localStorage.setItem("cqa.group", group);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  // poll a running batch
  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(async () => {
      try {
        const j = await api<{ job: Job }>(`/api/batches/${job.id}`);
        setJob(j.job);
        const d = await api<{ dialogues: Row[] }>(`/api/dialogues?group=${encodeURIComponent(group)}`);
        setRows(d.dialogues);
      } catch {}
    }, 2500);
    return () => clearInterval(t);
  }, [job, group]);

  async function fetchGroup() {
    setBusy("fetch");
    setError(null);
    try {
      const r = await api<{ groupId: string; count: number }>("/api/datasets/fetch", { method: "POST", json: { groupId: fetchId } });
      setGroup(r.groupId);
      await load(r.groupId);
    } catch (e: any) {
      setError(`Не удалось загрузить набор: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function uploadFile(f: File) {
    setBusy("upload");
    setError(null);
    try {
      const payload = JSON.parse(await f.text());
      const gid = `UPLOAD-${f.name.replace(/\.[^.]+$/, "").slice(0, 20)}`;
      const r = await api<{ groupId: string }>("/api/dialogues", { method: "POST", json: { groupId: gid, payload } });
      setGroup(r.groupId);
      await load(r.groupId);
    } catch (e: any) {
      setError(`Файл не принят: ${e.message}`);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function evaluateOne(id: string) {
    setEvaluating((s) => new Set(s).add(id));
    setError(null);
    try {
      await api("/api/evaluations", { method: "POST", json: { dialogueId: id } });
      const d = await api<{ dialogues: Row[] }>(`/api/dialogues?group=${encodeURIComponent(group)}`);
      setRows(d.dialogues);
    } catch (e: any) {
      setError(`${id}: ${e.message}`);
    } finally {
      setEvaluating((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  async function runBatch(onlyMissing: boolean) {
    setError(null);
    try {
      const r = await api<{ jobId: string }>("/api/batches", { method: "POST", json: { groupId: group, onlyMissing } });
      const j = await api<{ job: Job }>(`/api/batches/${r.jobId}`);
      setJob(j.job);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function switchChecklist(id: string) {
    setError(null);
    try {
      await api(`/api/checklists/${encodeURIComponent(id)}`, { method: "PATCH" });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  /** Re-evaluates only the dialogues whose latest result came from another checklist version. */
  async function reevaluateOutdated() {
    setError(null);
    try {
      const ids = rows.filter(isOutdated).map((r) => r.id);
      const r = await api<{ jobId: string }>("/api/batches", { method: "POST", json: { groupId: group, ids } });
      const j = await api<{ job: Job }>(`/api/batches/${r.jobId}`);
      setJob(j.job);
    } catch (e: any) {
      setError(e.message);
    }
  }

  /** Errors come back as text, so the file is fetched first and only then saved. */
  async function downloadResults() {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/export?group=${encodeURIComponent(group)}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "results.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveSettings(patch: Partial<SettingsResp["settings"]> | { reset: true }) {
    const r = await api<SettingsResp>("/api/settings", { method: "PUT", json: patch });
    setSettings(r);
  }

  const isOutdated = useCallback(
    (r: Row) => !!r.evaluation && !!active && (r.evaluation.checklistId !== active.id || r.evaluation.checklistVersion !== active.version),
    [active],
  );

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!filter.lang || r.language === filter.lang) &&
          (!filter.channel || r.channel === filter.channel) &&
          (!filter.q || r.id.toLowerCase().includes(filter.q.toLowerCase())) &&
          (!filter.status ||
            (filter.status === "none" && !r.evaluation) ||
            (filter.status === "gross" && r.evaluation?.gross) ||
            (filter.status === "low" && (r.evaluation?.lowConfidence.length ?? 0) > 0) ||
            (filter.status === "outdated" && isOutdated(r)) ||
            (filter.status === "appeal" && r.openAppeals > 0)),
      ),
    [rows, filter, isOutdated],
  );

  const stats = useMemo(() => {
    const ev = rows.filter((r) => r.evaluation?.status === "done" && !isOutdated(r));
    const totals = ev.map((r) => r.evaluation!.total).filter((t): t is number => t !== null);
    const crit = (active?.criteria ?? []).map((c) => {
      const answers = ev.map((r) => r.evaluation!.answers[c.id]).filter((a) => a !== undefined);
      const applicable = answers.filter((a) => a !== "na");
      const max = c.answerType === "scale" ? Math.max(...(c.steps ?? []).map((s) => s.value)) : 1;
      const good = applicable.filter((a) => (c.isFlag ? a === "yes" : c.answerType === "scale" ? Number(a) >= max : a === "yes")).length;
      return { c, rate: applicable.length ? good / applicable.length : null, n: applicable.length };
    });
    const costs = ev.map((r) => r.evaluation!.costUsd).filter((x): x is number => typeof x === "number");
    return {
      evaluated: ev.length,
      avg: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null,
      gross: ev.filter((r) => r.evaluation!.gross).length,
      low: ev.filter((r) => r.evaluation!.lowConfidence.length).length,
      appeals: rows.reduce((a, r) => a + r.openAppeals, 0),
      crit,
      avgCost: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
      outdated: rows.filter(isOutdated).length,
    };
  }, [rows, active, isOutdated]);

  const langs = [...new Set(rows.map((r) => r.language))].sort();
  const channels = [...new Set(rows.map((r) => r.channel))].sort();

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Набор диалогов">
            <select className={cx(inputCls, "min-w-40")} value={group} onChange={(e) => setGroup(e.target.value)}>
              {!groups.length && <option value="">— нет данных —</option>}
              {groups.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.groupId} ({g.count})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Чек-лист для оценки">
            <select
              className={cx(inputCls, "min-w-56")}
              value={active?.id ?? ""}
              disabled={job?.status === "running"}
              onChange={(e) => switchChecklist(e.target.value)}
            >
              {checklists.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · v{c.id === active?.id ? active.version : c.version}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Загрузить по group_id из API организаторов">
            <div className="flex gap-2">
              <input className={cx(inputCls, "w-36!")} value={fetchId} onChange={(e) => setFetchId(e.target.value)} placeholder="group_id" />
              <Button onClick={fetchGroup} disabled={!fetchId || busy === "fetch"}>
                {busy === "fetch" ? <Spinner /> : "⤓"} Загрузить
              </Button>
            </div>
          </Field>
          <div>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
            <Button onClick={() => fileRef.current?.click()} disabled={busy === "upload"}>
              {busy === "upload" ? <Spinner /> : "⇪"} Загрузить JSON-файл
            </Button>
          </div>
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <Button variant="ghost" onClick={() => setShowSettings((s) => !s)}>
              ⚙ Модель:{" "}
              <span className="font-mono text-xs">
                {settings?.settings.ensemble?.length
                  ? `ансамбль ×${settings.settings.ensemble.length}`
                  : `${settings?.settings.provider ?? "…"}/${settings?.settings.model ?? ""} ×${settings?.settings.samples ?? ""}`}
              </span>
            </Button>
            <Button onClick={() => runBatch(true)} disabled={!group || job?.status === "running"}>
              Оценить неоценённые
            </Button>
            <Button variant="primary" onClick={() => runBatch(false)} disabled={!group || job?.status === "running"}>
              {job?.status === "running" ? <Spinner /> : "▶"} Оценить все
            </Button>
          </div>
        </div>

        {showSettings && settings && <SettingsPanel s={settings} onSave={saveSettings} active={active} />}

        {job && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="mb-1 flex justify-between text-xs text-slate-600">
              <span>
                Пакетная оценка {job.status === "running" ? "идёт" : "завершена"}: {job.done + job.failed} / {job.total}
                {job.failed ? <span className="text-red-600"> · ошибок {job.failed}</span> : null}
              </span>
              {job.errors.length > 0 && <span className="truncate text-red-600" title={job.errors.join("\n")}>{job.errors.at(-1)}</span>}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${job.total ? ((job.done + job.failed) / job.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
      </Card>

      <ErrorNote error={error} />

      {stats.outdated > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>
            {stats.outdated} диал. оценены другой версией чек-листа. Показатели ниже считают только «{active?.name}» v{active?.version}.
          </span>
          <Button size="sm" className="ml-auto" onClick={reevaluateOutdated} disabled={job?.status === "running"}>
            ↻ Переоценить их
          </Button>
        </div>
      )}

      {/* dashboard */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Оценено" value={`${stats.evaluated} / ${rows.length}`} />
        <Stat label="Средний балл" value={stats.avg === null ? "—" : stats.avg.toFixed(1)} tone={totalTone(stats.avg)} />
        <Stat label="Грубые ошибки" value={String(stats.gross)} tone={stats.gross ? "text-red-600" : undefined} onClick={() => setFilter((f) => ({ ...f, status: f.status === "gross" ? "" : "gross" }))} />
        <Stat label="Нужна проверка" value={String(stats.low)} hint="голоса модели разошлись" tone={stats.low ? "text-amber-600" : undefined} onClick={() => setFilter((f) => ({ ...f, status: f.status === "low" ? "" : "low" }))} />
        <Stat label="Открытые апелляции" value={String(stats.appeals)} onClick={() => setFilter((f) => ({ ...f, status: f.status === "appeal" ? "" : "appeal" }))} />
        <Stat label="Стоимость оценки" value={stats.avgCost === null ? "—" : `$${stats.avgCost.toFixed(3)}`} hint="в среднем, все вызовы" />
      </div>

      {stats.evaluated > 0 && (
        <Card className="p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Выполнение критериев (среди применимых)</div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2 xl:grid-cols-4">
            {stats.crit.map(({ c, rate, n }) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className="w-56 truncate text-slate-700" title={c.title}>
                  {c.code}. {c.title}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className={cx("h-full", c.isFlag ? "bg-red-500" : "bg-brand-500")} style={{ width: `${(rate ?? 0) * 100}%` }} />
                </div>
                <span className="w-16 text-right text-xs tabular-nums text-slate-500">{rate === null ? "—" : `${Math.round(rate * 100)}%`} ({n})</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* table */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <input className={cx(inputCls, "w-48!")} placeholder="Поиск по ID" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          <select className={cx(inputCls, "w-28!")} value={filter.lang} onChange={(e) => setFilter({ ...filter, lang: e.target.value })}>
            <option value="">Все языки</option>
            {langs.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select className={cx(inputCls, "w-36!")} value={filter.channel} onChange={(e) => setFilter({ ...filter, channel: e.target.value })}>
            <option value="">Все каналы</option>
            {channels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select className={cx(inputCls, "w-56!")} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">Любой статус</option>
            <option value="none">Не оценены</option>
            <option value="gross">Грубые ошибки</option>
            <option value="low">Нужна проверка</option>
            <option value="outdated">Другая версия чек-листа</option>
            <option value="appeal">Есть апелляция</option>
          </select>
          <span className="ml-auto text-xs text-slate-500">{filtered.length} диалогов</span>
          {group && (
            <>
              <button className="text-xs font-medium text-brand-700 hover:underline" onClick={downloadResults} title="results.json в формате организаторов">
                Экспорт для сдачи (JSON)
              </button>
              <a className="text-xs text-brand-700 hover:underline" href={`${API_BASE}/api/export?group=${encodeURIComponent(group)}&format=csv`}>
                CSV
              </a>
            </>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Диалог</th>
                <th className="px-3 py-2">Язык</th>
                <th className="px-3 py-2">Канал</th>
                <th className="px-3 py-2 text-right">Реплик</th>
                {(active?.criteria ?? []).map((c) => (
                  <th key={c.id} className="px-1.5 py-2 text-center" title={c.title}>
                    {c.code}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Итог</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/dialogue/?id=${encodeURIComponent(r.id)}`} className="text-brand-700 hover:underline">
                      {r.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{r.language}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {r.channel === "voice call" ? "📞 звонок" : "💬 чат"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.turns}</td>
                  {(active?.criteria ?? []).map((c) => {
                    const a = r.evaluation?.answers[c.id];
                    const low = r.evaluation?.lowConfidence.includes(c.id);
                    return (
                      <td key={c.id} className={cx("px-1.5 py-2 text-center text-xs tabular-nums", isOutdated(r) && "opacity-40")}>
                        <span className={cx(low && "rounded bg-amber-100 px-1", a === "no" || a === 0 ? "text-red-600" : a === "na" ? "text-slate-400" : c.isFlag && a === "yes" ? "font-bold text-red-600" : "text-slate-700")}>
                          {a === undefined ? "" : a === "yes" ? (c.isFlag ? "⚠" : "✓") : a === "no" ? (c.isFlag ? "–" : "✗") : a === "na" ? "N/A" : a}
                        </span>
                      </td>
                    );
                  })}
                  <td className={cx("px-3 py-2 text-right font-semibold tabular-nums", totalTone(r.evaluation?.total), isOutdated(r) && "opacity-40")}>
                    {r.evaluation?.status === "done" ? (r.evaluation.total ?? "—") : ""}
                    {r.evaluation && r.evaluation.total !== r.evaluation.originalTotal && (
                      <div className="text-[10px] font-normal text-slate-400 line-through">{r.evaluation.originalTotal}</div>
                    )}
                  </td>
                  <td className="space-x-1 px-3 py-2">
                    {r.evaluation?.status === "error" && <Badge tone="red">ошибка</Badge>}
                    {isOutdated(r) && (
                      <Badge tone="amber" title="Оценка сделана другой версией чек-листа: колонки могут означать другие критерии">
                        {r.evaluation!.checklistId === active?.id ? `чек-лист v${r.evaluation!.checklistVersion}` : "другой чек-лист"}
                      </Badge>
                    )}
                    {r.evaluation?.gross && <Badge tone="red">грубая ошибка</Badge>}
                    {!!r.evaluation?.lowConfidence.length && <Badge tone="amber">проверить</Badge>}
                    {r.openAppeals > 0 && <Badge tone="violet">апелляция</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" onClick={() => evaluateOne(r.id)} disabled={evaluating.has(r.id) || job?.status === "running"}>
                      {evaluating.has(r.id) ? <Spinner /> : r.evaluation ? "↻" : "▶"} {r.evaluation ? "Переоценить" : "Оценить"}
                    </Button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={20} className="px-3 py-10 text-center text-slate-500">
                    {rows.length ? "Нет диалогов под фильтр." : "Загрузите набор по group_id (например, DEV) или JSON-файл."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone, hint, onClick }: { label: string; value: string; tone?: string; hint?: string; onClick?: () => void }) {
  return (
    <Card className={cx("p-3", onClick && "cursor-pointer hover:border-slate-300")}>
      <div onClick={onClick}>
        <div className="text-xs text-slate-500">{label}</div>
        <div className={cx("text-2xl font-semibold tabular-nums", tone)}>{value}</div>
        {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
      </div>
    </Card>
  );
}
