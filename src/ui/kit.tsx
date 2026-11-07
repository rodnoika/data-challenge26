"use client";
import type { ReactNode } from "react";
import type { Answer, Criterion } from "@/core/types";

// "Ledger" UI kit. Colours, type and corners come from the @theme tokens in app/globals.css;
// pages compose these pieces instead of styling raw elements.

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Button({
  children, onClick, variant = "secondary", disabled, type = "button", title, size = "md", className,
}: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean; type?: "button" | "submit"; title?: string; size?: "sm" | "md"; className?: string;
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-6 px-2 text-xs" : "h-8 px-3 text-sm",
        variant === "primary" && "border-accent bg-accent text-white hover:border-accent-strong hover:bg-accent-strong",
        variant === "secondary" && "border-rule bg-sheet text-ink hover:border-ink-4 hover:bg-paper",
        variant === "ghost" && "border-transparent text-ink-2 hover:bg-shade hover:text-ink",
        variant === "danger" && "border-fail/40 bg-sheet text-fail hover:bg-fail-soft",
        className,
      )}
    >
      {children}
    </button>
  );
}

export type Tone = "slate" | "green" | "red" | "amber" | "blue" | "violet";

const TAG: Record<Tone, string> = {
  slate: "border-rule bg-shade text-ink-2",
  green: "border-pass/30 bg-pass-soft text-pass",
  red: "border-fail/30 bg-fail-soft text-fail",
  amber: "border-warn/30 bg-warn-soft text-warn",
  blue: "border-accent/30 bg-accent-soft text-accent",
  violet: "border-appeal/30 bg-appeal-soft text-appeal",
};

/** Square status tag. Tone names are kept from the old kit so call sites read the same. */
export function Badge({ children, tone = "slate", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex h-[18px] items-center rounded-sm border px-1.5 text-2xs font-medium whitespace-nowrap", TAG[tone])}>
      {children}
    </span>
  );
}

/** Hairline-bordered sheet. No shadow, no rounded card. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("border border-rule bg-sheet", className)}>{children}</div>;
}

/** Sheet with a caption strip, for grouped content (summary, registry, editor blocks). */
export function Panel({ title, aside, children, className, bodyClassName }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx("border border-rule bg-sheet", className)}>
      <header className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule-soft px-3 py-1.5">
        <h2 className="label-caps">{title}</h2>
        {aside && <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-ink-3">{aside}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("label-caps", className)}>{children}</div>;
}

export function PageTitle({ children, sub, aside }: { children: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-rule pb-2">
      <div className="min-w-0">
        <h1 className="text-base font-semibold tracking-tight">{children}</h1>
        {sub && <p className="mt-0.5 max-w-3xl text-xs text-ink-3">{sub}</p>}
      </div>
      {aside && <div className="ml-auto flex flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/35 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-lg border border-ink-4 bg-sheet shadow-[0_12px_40px_-12px_rgb(26_29_33/0.35)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-rule px-4 py-2.5">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
          <button className="grid h-6 w-6 place-items-center text-ink-3 hover:bg-shade hover:text-ink" onClick={onClose} aria-label="Закрыть">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" /></svg>
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-2xs text-ink-3">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-sm border border-rule bg-sheet px-2 py-[5px] text-sm text-ink placeholder:text-ink-4 hover:border-ink-4 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-shade disabled:text-ink-3";

/** Two or more mutually exclusive options (tabs, decisions). */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex h-8 shrink-0 border border-rule bg-sheet text-sm" role="tablist">
      {options.map((o, i) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("px-3 whitespace-nowrap", i > 0 && "border-l border-rule", value === o.value ? "bg-ink font-medium text-paper" : "text-ink-2 hover:bg-shade")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent align-[-1px]" />;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="border border-fail/30 border-l-[3px] border-l-fail bg-fail-soft px-3 py-2 text-sm whitespace-pre-wrap text-fail">{error}</div>;
}

export function InfoNote({ children }: { children: ReactNode }) {
  return <div className="border border-accent/25 border-l-[3px] border-l-accent bg-accent-soft px-3 py-2 text-sm text-accent-strong">{children}</div>;
}

export function Loading({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-ink-3">
      <Spinner /> {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="border border-dashed border-rule px-4 py-10 text-center text-sm text-ink-3">{children}</div>;
}

/** Channel label without emoji: a tiny glyph plus text. */
export function Channel({ voice, short }: { voice: boolean; short?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink-2">
      {voice ? (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" className="text-ink-3">
          <path d="M2 4.5v3M4.5 2.5v7M7 4v4M9.5 1.5v9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" className="text-ink-3">
          <path d="M1.5 2.5h9v5.5H5L2.5 10V8h-1z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      )}
      {voice ? (short ? "звонок" : "звонок") : "чат"}
    </span>
  );
}

/** Language code in a fixed-width mono box, so RU/KZ/EN line up in tables. */
export function Lang({ code }: { code: string }) {
  return <span className="inline-block w-7 border border-rule bg-sheet text-center font-mono text-2xs leading-4 text-ink-2">{code}</span>;
}

/**
 * One answer as a compact glyph for dense grids.
 * yes ✓ / no ✗ / N/A – / scale value as a number / flag raised ▲ / flag clear ·
 */
export function AnswerMark({ c, a, low }: { c: Criterion | undefined; a: Answer | string | number | undefined; low?: boolean }) {
  if (a === undefined) return null;
  let glyph: ReactNode;
  let cls: string;
  let label: string;
  if (a === "na") {
    glyph = "–";
    cls = "text-na";
    label = "N/A";
  } else if (c?.isFlag) {
    const raised = a === "yes";
    glyph = raised ? "▲" : "·";
    cls = raised ? "text-fail font-semibold" : "text-ink-4";
    label = raised ? "грубая ошибка" : "нет";
  } else if (a === "yes") {
    glyph = "✓";
    cls = "text-pass";
    label = "да";
  } else if (a === "no") {
    glyph = "✗";
    cls = "text-fail";
    label = "нет";
  } else {
    const n = Number(a);
    const max = c?.steps?.length ? Math.max(...c.steps.map((s) => s.value)) : n;
    glyph = String(a);
    cls = n >= max ? "text-pass" : n === 0 ? "text-fail" : "text-warn";
    label = String(a);
  }
  return (
    <span
      title={low ? `${label} · голоса модели разошлись` : label}
      className={cx("inline-block min-w-5 px-0.5 text-center font-mono text-xs leading-5", cls, low && "bg-warn-soft outline outline-1 outline-warn/40")}
    >
      {glyph}
    </span>
  );
}

/** Red left rule + small caps: the single, unmistakable gross-error marker. */
export function GrossMark({ title }: { title?: string }) {
  return (
    <span title={title} className="inline-flex h-[18px] items-center border-l-[3px] border-fail bg-fail-soft pr-1.5 pl-1 text-2xs font-semibold tracking-[0.06em] text-fail uppercase">
      грубая ошибка
    </span>
  );
}

/** Turn reference used as evidence. Clicking scrolls the transcript (and seeks audio). */
export function EvidenceChip({ n, onClick, title }: { n: number; onClick?: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title ?? `Перейти к реплике #${n}`}
      className="h-5 border border-rule bg-sheet px-1.5 font-mono text-xs text-ink hover:border-warn hover:bg-mark-soft"
    >
      #{n}
    </button>
  );
}

/** Small horizontal rate bar (criteria fulfilment, CI ranges). */
export function Meter({ value, tone = "accent" }: { value: number | null; tone?: "accent" | "fail" }) {
  return (
    <div className="relative h-1.5 flex-1 bg-shade">
      <div className={cx("absolute inset-y-0 left-0", tone === "fail" ? "bg-fail" : "bg-accent")} style={{ width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` }} />
    </div>
  );
}

export const tableCls = "w-full border-collapse text-sm";
export const theadCls = "border-b border-rule bg-shade/70 text-left [&_th]:label-caps [&_th]:h-8 [&_th]:px-3 [&_th]:font-semibold";
export const rowCls = "border-b border-rule-soft last:border-b-0 hover:bg-paper";
