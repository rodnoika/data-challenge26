import type { Answer } from "./types";

export interface ExportRow {
  dialogueId: string;
  checklistId: string;
  checklistVersion: number;
  answers: { criterionId: string; answer: Answer }[];
  total: number | null;
  gross: boolean;
  model: string;
}

const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * One row per dialogue. The same criterion id can mean different things in different checklist versions,
 * so every row names its version, and criteria of every version present get a column.
 */
export function resultsCsv(rows: ExportRow[]): string {
  const criteria = [...new Set(rows.flatMap((r) => r.answers.map((a) => a.criterionId)))];
  const head = ["conversation_id", "checklist_id", "checklist_version", ...criteria, "total", "gross_error", "model"];
  const lines = rows.map((r) => {
    const by = new Map(r.answers.map((a) => [a.criterionId, a.answer]));
    return [r.dialogueId, r.checklistId, r.checklistVersion, ...criteria.map((c) => by.get(c) ?? ""), r.total ?? "", r.gross ? 1 : 0, r.model].map(cell).join(",");
  });
  return [head.map(cell).join(","), ...lines].join("\n");
}
