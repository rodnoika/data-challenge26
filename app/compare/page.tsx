"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/ui/api";
import { AnswerMark, Card, Channel, Empty, ErrorNote, Lang, Loading, PageTitle, Panel, Segmented, cx, inputCls, rowCls, tableCls, theadCls } from "@/ui/kit";
import { fmtTime, totalTone } from "@/ui/format";
import type { CompareRow, CompareSummary, CriterionChange } from "@/core/compare";
import type { Criterion } from "@/core/types";

type Version = { id: string; version: number; name: string; dialogues: number; lastAt: string };
type Ref = { id: string; version: number; name?: string };
type Resp = {
  group: string;
  versions: Version[];
  a: Ref | null;
  b: Ref | null;
  criteria?: Record<string, Criterion>;
  result: { changes: CriterionChange[]; rows: CompareRow[]; summary: CompareSummary } | null;
};

const refKey = (r: Ref | null | undefined) => (r ? `${r.id}@${r.version}` : "");
const pct = (x: number, n: number) => (n ? `${((100 * x) / n).toFixed(1)}%` : "—");

/** Before/after view of a checklist change on one dialogue set: what the replaced criterion did, per dialogue. */
export default function ComparePage() {
  const [group, setGroup] = useState("");
  const [groups, setGroups] = useState<{ groupId: string; count: number }[]>([]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<"changed" | "all">("changed");

  useEffect(() => {
    let saved = "";
    try {
      saved = localStorage.getItem("cqa.group") ?? "";
    } catch {}
    api<{ groups: { groupId: string; count: number }[] }>("/api/groups")
      .then((r) => {
        setGroups(r.groups);
        setGroup(saved && r.groups.some((g) => g.groupId === saved) ? saved : r.groups[0]?.groupId ?? "");
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!group) return;
    const q = new URLSearchParams({ group });
    if (a) q.set("a", a);
    if (b) q.set("b", b);
    setError(null);
    api<Resp>(`/api/compare?${q}`)
      .then((r) => {
        setData(r);
        if (!a && r.a) setA(refKey(r.a));
        if (!b && r.b) setB(refKey(r.b));
      })
      .catch((e) => setError(e.message));
  }, [group, a, b]);

  const crit = (id: string) => data?.criteria?.[id];
  const label = (id: string) => {
    const c = crit(id);
    return c ? `${c.code}. ${c.title}` : id;
  };
  const rows = useMemo(() => {
    const all = data?.result?.rows ?? [];
    const list = show === "changed" ? all.filter((r) => (r.delta ?? 0) !== 0 || r.touched.some((t) => String(t.before) !== String(t.after)) || r.sideEffects.length) : all;
    return [...list].sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0) || x.dialogueId.localeCompare(y.dialogueId));
  }, [data, show]);

  if (!data && !error) return <Loading />;
  const res = data?.result;
  const s = res?.summary;
  const touched = res?.changes.filter((c) => c.kind !== "same") ?? [];
  const versionLabel = (v: Version) => `${v.name} · v${v.version} · ${v.dialogues} диал. · ${fmtTime(v.lastAt)}`;

  return (
    <div className="space-y-3">
      <PageTitle
        sub="Одни и те же диалоги, оценённые до и после изменения чек-листа: что дал заменённый критерий и как сдвинулся итог. Ответы модели до апелляций."
        aside={
          groups.length > 0 && (
            <select className={cx(inputCls, "w-auto")} value={group} onChange={(e) => (setGroup(e.target.value), setA(""), setB(""))} title="Набор диалогов">
              {groups.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.groupId} ({g.count})
                </option>
              ))}
            </select>
          )
        }
      >
        Сравнение версий чек-листа
      </PageTitle>
      <ErrorNote error={error} />

      {data && data.versions.length < 2 && (
        <Empty>
          Нужны оценки этого набора двумя версиями чек-листа. Сохраните новую версию в «<Link href="/checklists/" className="underline">Чек-листы</Link>» и нажмите
          «Переоценить набор».
        </Empty>
      )}

      {data && data.versions.length >= 2 && (
        <Card className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
          {(
            [
              ["До (версия A)", a, setA],
              ["После (версия B)", b, setB],
            ] as const
          ).map(([title, value, set]) => (
            <label key={title} className="block min-w-0">
              <span className="label-caps">{title}</span>
              <select className={cx(inputCls, "mt-1 w-full")} value={value} onChange={(e) => set(e.target.value)}>
                {data.versions.map((v) => (
                  <option key={refKey(v)} value={refKey(v)}>
                    {versionLabel(v)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </Card>
      )}

      {res && s && (
        <>
          <Panel title="Что изменилось в чек-листе">
            {touched.length === 0 ? (
              <div className="px-3 py-2 text-sm text-ink-3">Критерии не менялись: различия ниже — разброс модели между прогонами.</div>
            ) : (
              <ul className="divide-y divide-rule-soft text-sm">
                {touched.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                    {c.kind === "replaced" && (
                      <>
                        <span className="label-caps !text-warn">заменён</span>
                        <span className="text-ink-3 line-through">{label(c.from)}</span>→<span className="font-medium">{label(c.to)}</span>
                      </>
                    )}
                    {c.kind === "edited" && (
                      <>
                        <span className="label-caps !text-warn">изменён</span>
                        <span className="font-medium">{label(c.id)}</span>
                        <span className="text-xs text-ink-3">{c.fields.join(", ")}</span>
                      </>
                    )}
                    {c.kind === "added" && (
                      <>
                        <span className="label-caps !text-pass">добавлен</span>
                        <span className="font-medium">{label(c.id)}</span>
                      </>
                    )}
                    {c.kind === "removed" && (
                      <>
                        <span className="label-caps !text-fail">удалён</span>
                        <span className="text-ink-3 line-through">{label(c.id)}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Card className="grid grid-cols-2 sm:grid-cols-4">
            <Tile label="Сравнено диалогов" value={s.compared} hint={s.onlyBefore || s.onlyAfter ? `ещё ${s.onlyBefore} только в A, ${s.onlyAfter} только в B` : "оценены обеими версиями"} />
            <Tile label="Итог изменился" value={<>{s.totalChanged}<span className="text-ink-4"> / {s.compared}</span></>} />
            <Tile
              label="Сдвиг итога, средний"
              value={s.meanDelta === null ? "—" : `${s.meanDelta > 0 ? "+" : ""}${s.meanDelta}`}
              hint={s.meanAbsDelta === null ? undefined : `по модулю ${s.meanAbsDelta}`}
            />
            <Tile
              label="Нетронутые критерии"
              value={pct(s.sideEffectAnswers, s.untouchedAnswers)}
              hint={`${s.sideEffectAnswers} из ${s.untouchedAnswers} ответов изменились — разброс модели`}
            />
          </Card>

          {s.touched.length > 0 && (
            <Panel title="Ответы по изменённым критериям (версия B)">
              <div className="divide-y divide-rule-soft">
                {s.touched.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-sm">
                    <span className="min-w-48 font-medium">{label(t.id)}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      {Object.entries(t.distribution)
                        .sort((x, y) => y[1] - x[1])
                        .map(([ans, n]) => (
                          <span key={ans} className="inline-flex items-center gap-1 border border-rule-soft px-1.5 font-mono text-xs">
                            {ans === "—" ? "—" : <AnswerMark c={crit(t.id)} a={/^\d+$/.test(ans) ? Number(ans) : ans} />}
                            <span className="text-ink-3">×{n}</span>
                          </span>
                        ))}
                    </span>
                    <span className="ml-auto text-xs text-ink-3">ответ сменился в {t.changed} из {s.compared}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel
            title="Диалоги"
            aside={
              <Segmented
                value={show}
                onChange={setShow}
                options={[
                  { value: "changed", label: "Изменились" },
                  { value: "all", label: "Все" },
                ]}
              />
            }
            bodyClassName="overflow-x-auto"
          >
            {rows.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-ink-3">Ни один диалог не изменился.</div>
            ) : (
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <th>Диалог</th>
                    <th>Язык</th>
                    <th>Канал</th>
                    {touched.map((c, i) => {
                      const id = c.kind === "replaced" ? c.to : c.id;
                      return (
                        <th key={i} className="text-center" title={label(id)}>
                          {crit(id)?.code ?? id} до → после
                        </th>
                      );
                    })}
                    <th className="text-right">Итог A</th>
                    <th className="text-right">Итог B</th>
                    <th className="text-right">Δ</th>
                    <th>Прочие изменения</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.dialogueId} className={cx(rowCls, r.grossAfter && "shadow-[inset_3px_0_0_var(--color-fail)]")}>
                      <td className="h-9 px-3 font-mono text-xs whitespace-nowrap">
                        <Link className="text-accent hover:underline" href={`/dialogue/?id=${encodeURIComponent(r.dialogueId)}`}>
                          {r.dialogueId}
                        </Link>
                      </td>
                      <td className="px-3">{r.language && <Lang code={r.language} />}</td>
                      <td className="px-3 text-xs whitespace-nowrap">
                        <Channel voice={r.channel === "voice call"} short />
                      </td>
                      {r.touched.map((t, i) => {
                        const c = touched[i];
                        const fromId = c?.kind === "replaced" ? c.from : t.id;
                        const moved = String(t.before) !== String(t.after);
                        return (
                          <td key={i} className={cx("px-2 text-center whitespace-nowrap", moved && "bg-mark-soft")}>
                            {t.before === null ? <span className="text-ink-4">—</span> : <AnswerMark c={crit(fromId)} a={t.before} />}
                            <span className="px-0.5 text-ink-4">→</span>
                            {t.after === null ? <span className="text-ink-4">—</span> : <AnswerMark c={crit(t.id)} a={t.after} />}
                          </td>
                        );
                      })}
                      <td className={cx("figures px-3 text-right font-mono text-xs", totalTone(r.totalBefore))}>{r.totalBefore ?? "—"}</td>
                      <td className={cx("figures px-3 text-right font-mono text-sm font-medium", totalTone(r.totalAfter))}>{r.totalAfter ?? "—"}</td>
                      <td className={cx("figures px-3 text-right font-mono text-xs", (r.delta ?? 0) > 0 ? "text-pass" : (r.delta ?? 0) < 0 ? "text-fail" : "text-ink-4")}>
                        {r.delta === null ? "—" : `${r.delta > 0 ? "+" : ""}${r.delta}`}
                      </td>
                      <td className="px-3 text-xs text-ink-3">
                        {r.sideEffects.map((x) => (
                          <span key={x.id} className="mr-2 inline-flex items-center whitespace-nowrap" title={label(x.id)}>
                            <span className="font-mono">{crit(x.id)?.code ?? x.id}</span>&nbsp;
                            <AnswerMark c={crit(x.id)} a={x.before} />→<AnswerMark c={crit(x.id)} a={x.after} />
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="-mb-px -ml-px min-w-0 border-b border-l border-rule-soft px-3 py-2">
      <div className="label-caps">{label}</div>
      <div className="figures mt-0.5 font-mono text-xl leading-7 font-medium text-ink">{value}</div>
      {hint && <div className="text-2xs text-ink-3">{hint}</div>}
    </div>
  );
}
