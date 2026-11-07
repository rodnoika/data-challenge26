import { describe, expect, it } from "vitest";
import { resultsCsv, type ExportRow } from "../src/core/export";

const row = (over: Partial<ExportRow>): ExportRow => ({
  dialogueId: "d1",
  checklistId: "cqa-default",
  checklistVersion: 1,
  answers: [{ criterionId: "c01", answer: "yes" }],
  total: 100,
  gross: false,
  model: "gpt-6.1-terra",
  ...over,
});

describe("resultsCsv", () => {
  it("names the checklist version on every row", () => {
    const [head, line] = resultsCsv([row({ checklistVersion: 2 })]).split("\n");
    expect(head).toBe("conversation_id,checklist_id,checklist_version,c01,total,gross_error,model");
    expect(line).toBe("d1,cqa-default,2,yes,100,0,gpt-6.1-terra");
  });

  it("keeps the answers of every version when a set mixes versions", () => {
    const csv = resultsCsv([
      row({ dialogueId: "old", answers: [{ criterionId: "c07", answer: "no" }] }),
      row({ dialogueId: "new", checklistVersion: 2, answers: [{ criterionId: "n07", answer: "yes" }], total: null, gross: true }),
    ]);
    expect(csv.split("\n")).toEqual([
      "conversation_id,checklist_id,checklist_version,c07,n07,total,gross_error,model",
      "old,cqa-default,1,no,,100,0,gpt-6.1-terra",
      "new,cqa-default,2,,yes,,1,gpt-6.1-terra",
    ]);
  });

  it("quotes values that would break the columns", () => {
    expect(resultsCsv([row({ model: 'a,"b"' })]).split("\n")[1]).toBe('d1,cqa-default,1,yes,100,0,"a,""b"""');
  });
});
