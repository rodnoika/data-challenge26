// Train/test selection for the accuracy harness. The test list is a fixed file, so a dialogue
// never changes sides as labels fill in.
export type SplitName = "train" | "test" | "all";

export function parseTestIds(text: string): Set<string> {
  return new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
}

export function selectSplit(ids: string[], which: string, testIds: Set<string>): string[] {
  if (which === "all") return ids;
  if (which !== "train" && which !== "test") throw new Error(`Unknown split "${which}". Use train, test or all.`);
  return ids.filter((id) => testIds.has(id) === (which === "test"));
}
