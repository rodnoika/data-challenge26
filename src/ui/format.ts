import type { Answer, Criterion } from "@/core/types";
import { formatAnswer } from "@/core/scoring";

export function answerTone(c: Criterion | undefined, a: Answer): "green" | "red" | "amber" | "slate" {
  if (a === "na") return "slate";
  if (c?.isFlag) return a === "yes" ? "red" : "green";
  if (a === "yes") return "green";
  if (a === "no") return "red";
  if (typeof a === "number" && c?.steps?.length) {
    const max = Math.max(...c.steps.map((s) => s.value));
    return a >= max ? "green" : a === 0 ? "red" : "amber";
  }
  return "slate";
}

export const fmtAnswer = formatAnswer;

export function fmtPoints(x: number) {
  return (Math.round(x * 100) / 100).toFixed(2).replace(/\.00$/, "");
}

export function totalTone(t: number | null | undefined) {
  if (t === null || t === undefined) return "text-slate-400";
  if (t >= 85) return "text-brand-700";
  if (t >= 60) return "text-amber-600";
  return "text-red-600";
}

export const LANG_FLAG: Record<string, string> = { RU: "RU", KZ: "KZ", EN: "EN" };

export function fmtTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
