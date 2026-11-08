"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, API_BASE } from "@/ui/api";
import { AnswerMark, Badge, Button, Card, Channel, ErrorNote, Field, GrossMark, Lang, Meter, Modal, Panel, Segmented, Spinner, cx, inputCls, rowCls, tableCls, theadCls } from "@/ui/kit";
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
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async (g?: string) => {
    const gr = await api<{ groups: { groupId: string; count: number }[] }>("/api/groups");
    setGroups(gr.groups);
    const known = (id: string) => gr.groups.some((x) => x.groupId === id);
    const target = g ?? (group && known(group) ? group : gr.groups[0]?.groupId || "");
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

  // The set to show comes from ?group= (the dialogue card links back with it), then from the last choice.
  // Nothing loads until it is known: otherwise the first load picks the first set and overwrites the choice.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let wanted = "";
    try {
      wanted = new URLSearchParams(window.location.search).get("group") ?? localStorage.getItem("cqa.group") ?? "";
    } catch {}
    if (wanted) setGroup(wanted);
    setReady(true);
    api<SettingsResp>("/api/settings").then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready) return;
    load().catch((e) => setError(String(e.message ?? e)));
    try {
      if (group) localStorage.setItem("cqa.group", group);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, ready]);

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


  const toggle = (s: string) => setFilter((f) => ({ ...f, status: f.status === s ? "" : s }));
  const criteria = active?.criteria ?? [];

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <Card>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 px-3 py-2.5">
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
            <div className="flex">
              <input className={cx(inputCls, "w-32 rounded-r-none")} value={fetchId} onChange={(e) => setFetchId(e.target.value)} placeholder="group_id" />
              <Button className="-ml-px rounded-l-none" onClick={fetchGroup} disabled={!fetchId || busy === "fetch"}>
                {busy === "fetch" && <Spinner />} Загрузить
              </Button>
            </div>
          </Field>
          <div>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])} />
            <Button onClick={() => fileRef.current?.click()} disabled={busy === "upload"}>
              {busy === "upload" && <Spinner />} Загрузить JSON-файл
            </Button>
          </div>
          <Button onClick={() => setAddOpen(true)}>Добавить по ссылке или JSON</Button>
          <div className="flex w-full flex-wrap items-end gap-2 lg:ml-auto lg:w-auto">
            <button
              onClick={() => setShowSettings((s) => !s)}
              aria-expanded={showSettings}
              className={cx(
                "flex h-8 min-w-0 items-center gap-2 border px-2.5 text-left text-xs",
                showSettings ? "border-ink-4 bg-paper" : "border-rule-soft bg-paper/60 hover:border-rule",
              )}
              title="Настройки модели оценки"
            >
              <span className="label-caps">Модель</span>
              <span className="truncate font-mono text-ink">
                {settings?.settings.ensemble?.length
                  ? `ансамбль ×${settings.settings.ensemble.length}`
                  : `${settings?.settings.provider ?? "…"}/${settings?.settings.model ?? ""} ×${settings?.settings.samples ?? ""}`}
              </span>
              <span className="text-ink-3">{showSettings ? "▴" : "▾"}</span>
            </button>
            <Button onClick={() => runBatch(true)} disabled={!group || job?.status === "running"}>
              Оценить неоценённые
            </Button>
            <Button variant="primary" onClick={() => runBatch(false)} disabled={!group || job?.status === "running"}>
              {job?.status === "running" && <Spinner />} Оценить все
            </Button>
          </div>
        </div>

        {showSettings && settings && <SettingsPanel s={settings} onSave={saveSettings} active={active} />}

        {job && (
          <div className="border-t border-rule-soft px-3 py-2">
            <div className="mb-1 flex gap-3 text-xs text-ink-2">
              <span className="figures shrink-0">
                Пакетная оценка {job.status === "running" ? "идёт" : "завершена"}: <b className="font-medium text-ink">{job.done + job.failed}</b> / {job.total}
                {job.failed ? <span className="text-fail"> · ошибок {job.failed}</span> : null}
              </span>
              {job.errors.length > 0 && <span className="ml-auto truncate text-fail" title={job.errors.join("\n")}>{job.errors.at(-1)}</span>}
            </div>
            <div className="h-[3px] bg-shade">
              <div className={cx("h-full transition-all", job.status === "running" ? "bg-accent" : "bg-ink-3")} style={{ width: `${job.total ? ((job.done + job.failed) / job.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
      </Card>

      <ErrorNote error={error} />

      <AddDialoguesModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onLoaded={async (gid) => {
          setAddOpen(false);
          setGroup(gid);
          await load(gid);
        }}
      />

      {stats.outdated > 0 && (
        <div className="flex flex-wrap items-center gap-3 border border-warn/30 border-l-[3px] border-l-warn bg-warn-soft px-3 py-2 text-sm text-warn">
          <span>
            {stats.outdated} диал. оценены другой версией чек-листа. Показатели ниже считают только «{active?.name}» v{active?.version}.
          </span>
          <Button size="sm" className="ml-auto" onClick={reevaluateOutdated} disabled={job?.status === "running"}>
            Переоценить их
          </Button>
        </div>
      )}

      {/* dashboard strip */}
      <Card className="grid grid-cols-2 overflow-hidden sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Оценено" value={<>{stats.evaluated}<span className="text-ink-4"> / {rows.length}</span></>} />
        <Stat label="Средний балл" value={stats.avg === null ? "—" : stats.avg.toFixed(1)} tone={totalTone(stats.avg)} />
        <Stat label="Грубые ошибки" value={String(stats.gross)} tone={stats.gross ? "text-fail" : undefined} active={filter.status === "gross"} onClick={() => toggle("gross")} />
        <Stat label="Нужна проверка" value={String(stats.low)} hint="голоса модели разошлись" tone={stats.low ? "text-warn" : undefined} active={filter.status === "low"} onClick={() => toggle("low")} />
        <Stat label="Открытые апелляции" value={String(stats.appeals)} tone={stats.appeals ? "text-appeal" : undefined} active={filter.status === "appeal"} onClick={() => toggle("appeal")} />
        <Stat label="Стоимость оценки" value={stats.avgCost === null ? "—" : `$${stats.avgCost.toFixed(3)}`} hint="в среднем, все вызовы" />
      </Card>

      {stats.evaluated > 0 && (
        <Panel title="Выполнение критериев (среди применимых)" bodyClassName="grid grid-cols-1 gap-x-8 gap-y-1 px-3 py-2.5 md:grid-cols-2 xl:grid-cols-4">
          {stats.crit.map(({ c, rate, n }) => (
            <div key={c.id} className="flex min-w-0 items-center gap-2 text-sm">
              <span className="w-5 shrink-0 font-mono text-xs text-ink-3">{c.code}</span>
              <span className="w-40 shrink-0 truncate text-ink-2 sm:w-44" title={c.title}>
                {c.title}
              </span>
              <Meter value={rate} tone={c.isFlag ? "fail" : "accent"} />
              <span className="figures w-16 shrink-0 text-right font-mono text-xs text-ink">
                {rate === null ? "—" : `${Math.round(rate * 100)}%`}
                <span className="text-ink-4"> {n}</span>
              </span>
            </div>
          ))}
        </Panel>
      )}

      {/* table */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2">
          <input className={cx(inputCls, "w-full sm:w-48")} placeholder="Поиск по ID" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          <select className={cx(inputCls, "w-[calc(50%-4px)] sm:w-28")} value={filter.lang} onChange={(e) => setFilter({ ...filter, lang: e.target.value })}>
            <option value="">Все языки</option>
            {langs.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select className={cx(inputCls, "w-[calc(50%-4px)] sm:w-36")} value={filter.channel} onChange={(e) => setFilter({ ...filter, channel: e.target.value })}>
            <option value="">Все каналы</option>
            {channels.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select className={cx(inputCls, "w-full sm:w-52")} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">Любой статус</option>
            <option value="none">Не оценены</option>
            <option value="gross">Грубые ошибки</option>
            <option value="low">Нужна проверка</option>
            <option value="outdated">Другая версия чек-листа</option>
            <option value="appeal">Есть апелляция</option>
          </select>
          <span className="figures ml-auto text-xs text-ink-3">{filtered.length} диалогов</span>
          {group && (
            <>
              <button className="text-xs font-medium text-accent hover:underline" onClick={downloadResults} title="results.json в формате организаторов">
                Экспорт для сдачи (JSON)
              </button>
              <a className="text-xs text-accent hover:underline" href={`${API_BASE}/api/export?group=${encodeURIComponent(group)}&format=csv`}>
                CSV
              </a>
            </>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th>Диалог</th>
                <th>Язык</th>
                <th>Канал</th>
                <th className="text-right">Реплик</th>
                {criteria.map((c, i) => (
                  <th key={c.id} className={cx("!px-0 text-center font-mono", i === 0 && "border-l border-rule-soft")} title={`${c.code}. ${c.title}`}>
                    {c.code}
                  </th>
                ))}
                <th className="border-l border-rule text-right">Итог</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={cx(rowCls, r.evaluation?.gross && "shadow-[inset_3px_0_0_var(--color-fail)]")}>
                  <td className="h-9 px-3 font-mono text-xs whitespace-nowrap">
                    <Link href={`/dialogue/?id=${encodeURIComponent(r.id)}`} className="text-accent hover:underline">
                      {r.id}
                    </Link>
                  </td>
                  <td className="px-3">
                    <Lang code={r.language} />
                  </td>
                  <td className="px-3 text-xs whitespace-nowrap">
                    <Channel voice={r.channel === "voice call"} />
                  </td>
                  <td className="figures px-3 text-right font-mono text-xs text-ink-3">{r.turns}</td>
                  {criteria.map((c, i) => (
                    <td key={c.id} className={cx("px-0.5 text-center", i === 0 && "border-l border-rule-soft", isOutdated(r) && "opacity-40")}>
                      <AnswerMark c={c} a={r.evaluation?.answers[c.id]} low={r.evaluation?.lowConfidence.includes(c.id)} />
                    </td>
                  ))}
                  <td className={cx("figures border-l border-rule px-3 text-right font-mono text-sm font-medium", totalTone(r.evaluation?.total), isOutdated(r) && "opacity-40")}>
                    {r.evaluation?.status === "done" ? (r.evaluation.total ?? "—") : ""}
                    {r.evaluation && r.evaluation.total !== r.evaluation.originalTotal && (
                      <div className="text-2xs leading-3 font-normal text-ink-4 line-through">{r.evaluation.originalTotal}</div>
                    )}
                  </td>
                  <td className="px-3">
                    <div className="flex flex-wrap gap-1">
                      {r.evaluation?.status === "error" && <Badge tone="red">ошибка</Badge>}
                      {isOutdated(r) && (
                        <Badge tone="amber" title="Оценка сделана другой версией чек-листа: колонки могут означать другие критерии">
                          {r.evaluation!.checklistId === active?.id ? `чек-лист v${r.evaluation!.checklistVersion}` : "другой чек-лист"}
                        </Badge>
                      )}
                      {r.evaluation?.gross && <GrossMark />}
                      {!!r.evaluation?.lowConfidence.length && <Badge tone="amber">проверить</Badge>}
                      {r.openAppeals > 0 && <Badge tone="violet">апелляция</Badge>}
                    </div>
                  </td>
                  <td className="px-3 text-right">
                    <Button size="sm" variant={r.evaluation ? "ghost" : "secondary"} onClick={() => evaluateOne(r.id)} disabled={evaluating.has(r.id) || job?.status === "running"}>
                      {evaluating.has(r.id) && <Spinner />} {r.evaluation ? "Переоценить" : "Оценить"}
                    </Button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={20} className="px-3 py-10 text-center text-ink-3">
                    {rows.length ? "Нет диалогов под фильтр." : "Загрузите набор по group_id (например, DEV) или JSON-файл."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {criteria.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-rule-soft px-3 py-1.5 text-2xs text-ink-3">
            <span><span className="font-mono text-pass">✓</span> да</span>
            <span><span className="font-mono text-fail">✗</span> нет</span>
            <span><span className="font-mono text-na">–</span> N/A</span>
            <span><span className="font-mono text-warn">5</span> ступень шкалы</span>
            <span><span className="font-mono font-semibold text-fail">▲</span> флаг грубой ошибки</span>
            <span><span className="bg-warn-soft px-1 font-mono outline outline-1 outline-warn/40">✓</span> голоса разошлись</span>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone, hint, onClick, active }: { label: string; value: React.ReactNode; tone?: string; hint?: string; onClick?: () => void; active?: boolean }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      aria-pressed={onClick ? !!active : undefined}
      className={cx(
        "-mb-px -ml-px min-w-0 border-b border-l border-rule-soft px-3 py-2 text-left",
        onClick && "cursor-pointer hover:bg-paper",
        active && "bg-accent-soft shadow-[inset_0_-2px_0_var(--color-accent)]",
      )}
    >
      <div className="label-caps flex items-center gap-1">
        {label}
        {onClick && <span className="font-normal normal-case tracking-normal text-ink-4">{active ? "· фильтр" : ""}</span>}
      </div>
      <div className={cx("figures mt-0.5 font-mono text-xl leading-7 font-medium text-ink", tone)}>{value}</div>
      <div className="h-4 truncate text-2xs text-ink-3">{hint}</div>
    </Tag>
  );
}

/**
 * Adds dialogues from a pasted API link (fetched by the server, so no CORS) or from pasted JSON.
 * Accepts the organisers' payload ({ data: { records } }), an array of dialogues or a single dialogue.
 */
function AddDialoguesModal({ open, onClose, onLoaded }: { open: boolean; onClose: () => void; onLoaded: (groupId: string) => Promise<void> }) {
  const [mode, setMode] = useState<"url" | "json">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setDone(null);
    }
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      let r: { groupId: string; count: number };
      if (mode === "url") {
        r = await api("/api/datasets/fetch", { method: "POST", json: { url: url.trim(), groupId: groupId.trim() || undefined } });
      } else {
        let payload: any;
        try {
          payload = JSON.parse(text);
        } catch (e: any) {
          throw new Error(`JSON не разобран: ${e.message}`);
        }
        const gid = groupId.trim() || payload?.data?.dataset_group_id || "UPLOAD-JSON";
        r = await api("/api/dialogues", { method: "POST", json: { groupId: gid, payload } });
      }
      setDone(`Загружено ${r.count} диал. в набор ${r.groupId}`);
      setUrl("");
      setText("");
      await onLoaded(r.groupId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const ready = mode === "url" ? url.trim().length > 0 : text.trim().length > 0;
  return (
    <Modal open={open} onClose={onClose} title="Добавить диалоги">
      <div className="space-y-3">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "url", label: "Ссылка API" },
            { value: "json", label: "Вставить JSON" },
          ]}
        />
        {mode === "url" ? (
          <Field label="Адрес API (GET)" hint="Сервер скачает набор сам. Принимаются только https-ссылки организаторов и хосты из CQA_FETCH_ALLOWED_HOSTS; ссылка нигде не сохраняется.">
            <input className={inputCls} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/invoke?…&group_id=FBroker" autoFocus />
          </Field>
        ) : (
          <Field label="JSON с диалогами" hint="Формат организаторов { data: { records: [...] } }, массив диалогов или один диалог с conversation_id и transcript.">
            <textarea className={cx(inputCls, "h-48 font-mono text-xs")} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"data":{"records":[{"conversation_id":"…","channel":"agent chat","language":"RU","transcript":[…]}]}}' />
          </Field>
        )}
        <Field label="Название набора (необязательно)" hint="По умолчанию берётся из данных: dataset_group_id или group_id в ссылке.">
          <input className={inputCls} value={groupId} onChange={(e) => setGroupId(e.target.value)} placeholder="например FBroker" />
        </Field>
        <ErrorNote error={error} />
        {done && <div className="text-sm text-pass">{done}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button variant="primary" onClick={submit} disabled={!ready || busy}>
            {busy && <Spinner />} Загрузить
          </Button>
        </div>
      </div>
    </Modal>
  );
}
