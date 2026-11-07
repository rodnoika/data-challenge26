"use client";

import Link from "next/link";
import { Badge, Field, inputCls } from "./kit";
import type { Checklist } from "@/core/types";

type RegistryModel = { provider: string; model: string; label: string; tier: string; price: { in: number; out: number } | null; checkedAt: string | null };
export type SettingsResp = {
  settings: {
    provider: string;
    model: string;
    samples: number;
    reasoning: string;
    concurrency: number;
    ensemble: { provider: string; model: string }[] | null;
    source: string;
  };
  providers: string[];
  keys: Record<string, boolean>;
  registry: { default: { provider: string; model: string; chosenBy: string } | null; models: RegistryModel[] };
};

export const TIER: Record<string, string> = { frontier: "флагман", mid: "средняя", cheap: "дешёвая", local: "локальная", ensemble: "ансамбль" };

/** Model selection from the registry (config/models.json). No vendor is pre-selected by the UI. */
export function SettingsPanel({
  s, onSave, active,
}: {
  s: SettingsResp;
  onSave: (p: Partial<SettingsResp["settings"]> | { reset: true }) => void;
  active: Checklist | null;
}) {
  const current = `${s.settings.provider}/${s.settings.model}`;
  const inRegistry = s.registry.models.some((m) => `${m.provider}/${m.model}` === current);
  const ens = s.settings.ensemble?.length ? s.settings.ensemble : null;
  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="col-span-2">
          <Field label="Модель оценки (реестр config/models.json)">
            <select
              className={inputCls}
              value={ens ? "" : current}
              onChange={(e) => {
                const [provider, ...rest] = e.target.value.split("/");
                if (provider) onSave({ provider, model: rest.join("/"), ensemble: null });
              }}
            >
              {ens && <option value="">ансамбль: {ens.map((v) => v.model).join(" + ")}</option>}
              {!ens && !inRegistry && <option value={current}>{current} (вне реестра)</option>}
              {s.providers.map((p) => (
                <optgroup key={p} label={`${p}${s.keys[p] ? "" : " — нет ключа"}`}>
                  {s.registry.models
                    .filter((m) => m.provider === p)
                    .map((m) => (
                      <option key={m.model} value={`${m.provider}/${m.model}`} disabled={!s.keys[p]}>
                        {m.label} · {TIER[m.tier] ?? m.tier}
                        {m.price && m.provider !== "ollama" ? ` · $${m.price.in} / $${m.price.out} за 1M` : ""}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Голосов на диалог" hint="самосогласованность">
          <select className={inputCls} value={s.settings.samples} onChange={(e) => onSave({ samples: Number(e.target.value) })}>
            {[1, 3, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Глубина рассуждений" hint="одинаково для всех вендоров">
          <select className={inputCls} value={s.settings.reasoning} onChange={(e) => onSave({ reasoning: e.target.value })}>
            {["low", "medium", "high"].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Параллельно">
          <input type="number" min={1} max={12} className={inputCls} value={s.settings.concurrency} onChange={(e) => onSave({ concurrency: Number(e.target.value) })} />
        </Field>
        <div className="text-xs text-slate-500">
          Активный чек-лист:
          <br />
          <Link className="font-medium text-brand-700 hover:underline" href="/checklists/">
            {active?.name} · v{active?.version}
          </Link>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>
          Источник выбора: <b className="text-slate-700">{s.settings.source}</b>
        </span>
        {s.registry.default ? (
          <span>
            По умолчанию (бенчмарк): <span className="font-mono">{s.registry.default.provider}/{s.registry.default.model}</span>
          </span>
        ) : (
          <Badge tone="amber">модель по умолчанию ещё не выбрана бенчмарком</Badge>
        )}
        <button className="text-brand-700 hover:underline" onClick={() => onSave({ reset: true })}>
          Сбросить к модели по умолчанию
        </button>
        <Link href="/models/" className="ml-auto text-brand-700 hover:underline">
          Сравнение моделей →
        </Link>
      </div>
    </div>
  );
}
