import type { Answer, Checklist, Judgment } from "./types";

/**
 * Self-consistency: combine N independent judgments per criterion.
 * Yes/No/N/A -> majority (ties broken by the first sample); scale -> median step
 * (unless N/A is the majority). Any disagreement marks the criterion low-confidence.
 */
export function aggregate(cl: Checklist, samples: Judgment[][]): Judgment[] {
  const out: Judgment[] = [];
  for (const c of cl.criteria) {
    const js = samples.map((s) => s.find((j) => j.criterionId === c.id)).filter(Boolean) as Judgment[];
    if (!js.length) continue;
    const votes = js.map((j) => j.answer);
    let final: Answer;
    const counts = new Map<string, number>();
    for (const v of votes) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    const naCount = counts.get("na") ?? 0;
    if (c.answerType === "scale" && naCount * 2 <= votes.length) {
      const nums = votes.filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
      // lower median for even counts: conservative
      final = nums[Math.floor((nums.length - 1) / 2)];
    } else {
      let best = String(votes[0]);
      let bestN = 0;
      for (const v of votes) {
        const n = counts.get(String(v))!;
        if (n > bestN) {
          best = String(v);
          bestN = n;
        }
      }
      final = votes.find((v) => String(v) === best)!;
    }
    const rep = js.find((j) => String(j.answer) === String(final)) ?? js[0];
    const unanimous = counts.size === 1;
    out.push({
      ...rep,
      answer: final,
      votes,
      confidence: unanimous ? "high" : "low",
    });
  }
  return out;
}
