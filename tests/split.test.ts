import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTestIds, selectSplit } from "../src/core/split";

const testIds = parseTestIds(readFileSync("data/splits/dev-test-ids.txt", "utf8"));

describe("selectSplit", () => {
  const ids = ["a", "b", "c"];
  const test = new Set(["b"]);

  it("separates train and test without overlap", () => {
    expect(selectSplit(ids, "test", test)).toEqual(["b"]);
    expect(selectSplit(ids, "train", test)).toEqual(["a", "c"]);
  });

  it("returns everything for all", () => {
    expect(selectSplit(ids, "all", test)).toEqual(ids);
  });

  it("rejects an unknown split name", () => {
    expect(() => selectSplit(ids, "holdout", test)).toThrow(/Unknown split/);
  });
});

describe("parseTestIds", () => {
  it("skips comments and blank lines, including CRLF files", () => {
    expect([...parseTestIds("# note\r\n\r\np1-ru-001\r\n")]).toEqual(["p1-ru-001"]);
  });
});

describe("DEV test list", () => {
  const count = (prefix: string) => [...testIds].filter((id) => id.startsWith(prefix)).length;

  it("keeps the agreed quotas", () => {
    expect(testIds.size).toBe(20);
    expect(count("p1-ru-")).toBe(8);
    expect(count("p1-kz-")).toBe(5);
    expect(count("p1-en-")).toBe(5);
    expect(count("p4-ru-")).toBe(2);
  });

  it("keeps the dialogues the rules were written from in train", () => {
    for (const id of ["p1-ru-002", "p1-ru-003", "p1-ru-018", "p1-ru-025", "p1-ru-028", "p4-ru-002"]) {
      expect(testIds.has(id)).toBe(false);
    }
  });
});
