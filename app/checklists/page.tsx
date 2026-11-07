"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/ui/api";
import { Badge, Button, Card, ErrorNote, Field, Spinner, cx, inputCls } from "@/ui/kit";
import { fmtTime } from "@/ui/format";
import { buildSystemPrompt } from "@/core/prompt";
import { staleHints, validateChecklist } from "@/core/scoring";
import type { Checklist, Criterion } from "@/core/types";

type ListItem = { id: string; name: string; version: number; isActive: boolean; updatedAt: string };

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function nextId(cl: Checklist) {
  let n = cl.criteria.length + 1;
  const ids = new Set(cl.criteria.map((c) => c.id));
  while (ids.has(`c${String(n).padStart(2, "0")}`)) n++;
  return { id: `c${String(n).padStart(2, "0")}`, code: String(n).padStart(2, "0") };
}

export default function ChecklistsPage() {
  const [list, setList] = useState<ListItem[]>([]);
  const [draft, setDraft] = useState<Checklist | null>(null);
  const [saved, setSaved] = useState<Checklist | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activate, setActivate] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);
  const [activeRef, setActiveRef] = useState<{ id: string; version: number } | null>(null);

  async function loadList(selectId?: string) {
    const r = await api<{ checklists: ListItem[]; active: Checklist }>("/api/checklists");
    setList(r.checklists);
    setActiveRef({ id: r.active.id, version: r.active.version });
    const target = selectId ? (await api<{ checklist: Checklist }>(`/api/checklists/${selectId}`)).checklist : r.active;
    setDraft(clone(target));
    setSaved(clone(target));
  }
  useEffect(() => {
    loadList().catch((e) => setError(e.message));
  }, []);

  const problems = useMemo(() => (draft ? validateChecklist(draft) : []), [draft]);
  const stale = useMemo(() => (draft && saved ? staleHints(saved, draft) : []), [draft, saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const weightSum = draft?.criteria.filter((c) => !c.isFlag).reduce((a, c) => a + (Number(c.weight) || 0), 0) ?? 0;

  if (!draft) return <div className="p-8 text-slate-500"><Spinner /> Загрузка…</div>;

  const upd = (patch: Partial<Checklist>) => setDraft({ ...draft, ...patch });
  const updC = (id: string, patch: Partial<Criterion>) =>
    setDraft({ ...draft, criteria: draft.criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const move = (id: string, dir: -1 | 1) => {
    const i = draft.criteria.findIndex((c) => c.id === id);
    const j = i + dir;
    if (j < 0 || j >= draft.criteria.length) return;
    const arr = [...draft.criteria];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setDraft({ ...draft, criteria: arr });
  };
  const addCriterion = () => {
    const { id, code } = nextId(draft);
    const c: Criterion = {
      id,
      code,
      sectionId: draft.sections[0]?.id ?? "s1",
      title: "Новый критерий",
      description: "Да — …",
      answerType: "yes_no",
      naAllowed: false,
      weight: 10,
      isFlag: false,
    };
    setDraft({ ...draft, criteria: [...draft.criteria, c] });
    setOpen(id);
  };

  async function save() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await api<{ checklist: Checklist }>(`/api/checklists/${encodeURIComponent(draft!.id)}`, {
        method: "PUT",
        json: { checklist: draft, activate },
      });
      setInfo(`Сохранено: «${r.checklist.name}» версия ${r.checklist.version}${activate ? " — активна, новые оценки используют её" : ""}.`);
      await loadList(r.checklist.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAsNew() {
    const copy = { ...clone(draft!), id: "", name: `${draft!.name} (копия)`, version: 0 };
    setBusy(true);
    try {
      const r = await api<{ checklist: Checklist }>(`/api/checklists`, { method: "POST", json: { checklist: copy, activate: false } });
      await loadList(r.checklist.id);
      setInfo("Создана копия чек-листа.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function makeActive() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/checklists/${encodeURIComponent(saved!.id)}`, { method: "PATCH" });
      await loadList(saved!.id);
      setInfo(`«${saved!.name}» v${saved!.version} активен: новые оценки используют его.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reevaluateGroup() {
    let group = "";
    try {
      group = localStorage.getItem("cqa.group") ?? "";
    } catch {}
    if (!group) return setError("Сначала выберите набор диалогов на странице «Диалоги».");
    await api("/api/batches", { method: "POST", json: { groupId: group } });
    setInfo(`Запущена переоценка набора ${group} активным чек-листом. Прогресс — на странице «Диалоги».`);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Чек-листы</h2>
        {list.map((l) => (
          <button
            key={l.id}
            onClick={() => loadList(l.id)}
            className={cx("w-full rounded-lg border px-3 py-2 text-left text-sm", l.id === draft.id ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white hover:bg-slate-50")}
          >
            <div className="font-medium">{l.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              v{l.version} · {fmtTime(l.updatedAt)} {l.isActive && <Badge tone="green">активный</Badge>}
            </div>
          </button>
        ))}
        <Button size="sm" onClick={saveAsNew} disabled={busy}>
          ⧉ Копия текущего
        </Button>
      </div>

      <div className="space-y-3">
        <Card className="p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]">
            <Field label="Название">
              <input className={inputCls} value={draft.name} onChange={(e) => upd({ name: e.target.value })} />
            </Field>
            <Field label="Порог ожидания, сек" hint="только подсветка пауз в карточке, на балл не влияет">
              <input type="number" className={inputCls} value={draft.waitThresholdSec} onChange={(e) => upd({ waitThresholdSec: Number(e.target.value) })} />
            </Field>
          </div>
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium text-slate-600">Секции</div>
            <div className="flex flex-wrap gap-2">
              {draft.sections.map((s, i) => (
                <input
                  key={s.id}
                  className={cx(inputCls, "w-64")}
                  value={s.title}
                  onChange={(e) => upd({ sections: draft.sections.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })}
                />
              ))}
              <Button size="sm" variant="ghost" onClick={() => upd({ sections: [...draft.sections, { id: `s${Date.now().toString(36)}`, title: "Новая секция" }] })}>
                + секция
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex items-center gap-3 px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Критерии ({draft.criteria.length})</h2>
          <span className={cx("text-xs", weightSum === 100 ? "text-slate-500" : "text-amber-700")}>
            сумма весов {weightSum}
            {weightSum !== 100 && " — итог всё равно нормируется к 100"}
          </span>
          <Button size="sm" className="ml-auto" onClick={addCriterion}>
            + Добавить критерий
          </Button>
        </div>

        {draft.criteria.map((c, idx) => (
          <Card key={c.id} className={cx(open === c.id && "ring-2 ring-brand-100")}>
            <div className="flex cursor-pointer items-center gap-2 px-4 py-2.5" onClick={() => setOpen(open === c.id ? null : c.id)}>
              <span className="font-mono text-xs text-slate-400">{c.code}</span>
              <span className="font-medium">{c.title}</span>
              <Badge tone="slate">{c.isFlag ? "флаг" : c.answerType === "yes_no" ? "Да/Нет" : `шкала ${(c.steps ?? []).map((s) => s.value).join("/")}`}</Badge>
              {c.naAllowed && <Badge tone="blue">N/A</Badge>}
              <span className="ml-auto text-xs text-slate-500">{c.isFlag ? "без баллов" : `вес ${c.weight}`}</span>
              <span className="text-xs text-slate-400">{draft.sections.find((s) => s.id === c.sectionId)?.title}</span>
              <span className="text-slate-400">{open === c.id ? "▴" : "▾"}</span>
            </div>
            {open === c.id && (
              <div className="space-y-3 border-t border-slate-100 p-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                  <Field label="Код">
                    <input className={inputCls} value={c.code} onChange={(e) => updC(c.id, { code: e.target.value })} />
                  </Field>
                  <div className="col-span-2 md:col-span-3">
                    <Field label="Название">
                      <input className={inputCls} value={c.title} onChange={(e) => updC(c.id, { title: e.target.value })} />
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="Секция">
                      <select className={inputCls} value={c.sectionId} onChange={(e) => updC(c.id, { sectionId: e.target.value })}>
                        {draft.sections.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
                <Field label="Формулировка (что значит «Да» / как выбирать ступень)">
                  <textarea className={cx(inputCls, "h-20")} value={c.description} onChange={(e) => updC(c.id, { description: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Field label="Тип ответа">
                    <select
                      className={inputCls}
                      value={c.isFlag ? "flag" : c.answerType}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "flag") updC(c.id, { isFlag: true, answerType: "yes_no", weight: 0, naAllowed: false });
                        else if (v === "scale")
                          updC(c.id, {
                            isFlag: false,
                            answerType: "scale",
                            steps: c.steps?.length ? c.steps : [
                              { value: 0, description: "" },
                              { value: 5, description: "" },
                              { value: 10, description: "" },
                            ],
                          });
                        else updC(c.id, { isFlag: false, answerType: "yes_no" });
                      }}
                    >
                      <option value="yes_no">Да / Нет</option>
                      <option value="scale">Шкала</option>
                      <option value="flag">Флаг (без баллов)</option>
                    </select>
                  </Field>
                  <Field label="Вес">
                    <input type="number" min={0} className={inputCls} disabled={c.isFlag} value={c.weight} onChange={(e) => updC(c.id, { weight: Number(e.target.value) })} />
                  </Field>
                  <Field label="N/A">
                    <label className="flex h-[34px] items-center gap-2 text-sm">
                      <input type="checkbox" disabled={c.isFlag} checked={c.naAllowed} onChange={(e) => updC(c.id, { naAllowed: e.target.checked })} /> допускается
                    </label>
                  </Field>
                </div>
                {c.naAllowed && (
                  <Field label="Условие N/A">
                    <input className={inputCls} value={c.naCondition ?? ""} onChange={(e) => updC(c.id, { naCondition: e.target.value })} />
                  </Field>
                )}
                {c.answerType === "scale" && !c.isFlag && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-slate-600">Ступени шкалы (верхняя ступень даёт полный вес)</div>
                    <div className="space-y-1.5">
                      {(c.steps ?? []).map((s, i) => (
                        <div key={i} className="flex gap-2">
                          <input
                            type="number"
                            className={cx(inputCls, "w-20")}
                            value={s.value}
                            onChange={(e) => updC(c.id, { steps: c.steps!.map((x, k) => (k === i ? { ...x, value: Number(e.target.value) } : x)) })}
                          />
                          <input
                            className={inputCls}
                            value={s.description}
                            placeholder="Описание ступени"
                            onChange={(e) => updC(c.id, { steps: c.steps!.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)) })}
                          />
                          <Button size="sm" variant="ghost" onClick={() => updC(c.id, { steps: c.steps!.filter((_, k) => k !== i) })}>
                            ✕
                          </Button>
                        </div>
                      ))}
                      <Button size="sm" variant="ghost" onClick={() => updC(c.id, { steps: [...(c.steps ?? []), { value: 0, description: "" }] })}>
                        + ступень
                      </Button>
                    </div>
                  </div>
                )}
                <Field label="Подсказка для оценщика (необязательно)">
                  <textarea rows={3} className={inputCls} value={c.guidance ?? ""} onChange={(e) => updC(c.id, { guidance: e.target.value })} />
                  {stale.includes(c.id) && (
                    <div className="mt-1 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <span>Критерий изменён, а подсказка осталась от старого: оценщик продолжит применять её правила.</span>
                      <Button size="sm" className="ml-auto shrink-0" onClick={() => updC(c.id, { guidance: "" })}>
                        Очистить подсказку
                      </Button>
                    </div>
                  )}
                </Field>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => move(c.id, -1)} disabled={idx === 0}>
                    ↑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => move(c.id, 1)} disabled={idx === draft.criteria.length - 1}>
                    ↓
                  </Button>
                  <Button size="sm" variant="danger" className="ml-auto" onClick={() => setDraft({ ...draft, criteria: draft.criteria.filter((x) => x.id !== c.id) })}>
                    Удалить критерий
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))}

        <Card className="p-4">
          <Field label="Общие правила оценки (памятка чек-листа и интерпретации) — передаются оценщику дословно">
            <textarea className={cx(inputCls, "h-56 font-mono text-xs")} value={draft.rules} onChange={(e) => upd({ rules: e.target.value })} />
          </Field>
          <button className="mt-2 text-xs text-brand-700 hover:underline" onClick={() => setShowPrompt((s) => !s)}>
            {showPrompt ? "Скрыть" : "Показать"} промпт, сгенерированный из этого чек-листа
          </button>
          {showPrompt && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{buildSystemPrompt(draft)}</pre>}
        </Card>

        <div className="sticky bottom-0 z-10 -mx-1 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          {problems.length > 0 && <ErrorNote error={problems.join("\n")} />}
          {stale.length > 0 && (
            <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Проверьте подсказки критериев {stale.map((id) => draft.criteria.find((c) => c.id === id)?.code ?? id).join(", ")}: они написаны для старых формулировок.
            </div>
          )}
          <ErrorNote error={error} />
          {info && <div className="mb-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">{info}</div>}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> сделать активным
            </label>
            <span className="text-xs text-slate-500">
              Сохранение создаёт новую версию; прошлые оценки хранят свою.{activeRef && ` Сейчас оценивает v${activeRef.version}${activeRef.id === saved?.id ? "" : " другого чек-листа"}.`}
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(clone(saved!))}>
                Отменить изменения
              </Button>
              {saved && activeRef && (saved.id !== activeRef.id || saved.version !== activeRef.version) && (
                <Button onClick={makeActive} disabled={busy}>
                  ✓ Сделать этот чек-лист активным
                </Button>
              )}
              <Button onClick={reevaluateGroup}>↻ Переоценить набор</Button>
              <Button variant="primary" disabled={!dirty || busy || problems.length > 0} onClick={save}>
                {busy && <Spinner />} Сохранить версию
              </Button>
            </div>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            После сохранения откройте <Link href="/" className="underline">диалог</Link> и нажмите «Переоценить» — новый критерий оценивается без изменений кода.
          </div>
        </div>
      </div>
    </div>
  );
}
