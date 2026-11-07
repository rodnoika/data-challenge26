// Writes data/readable/<id>.md (numbered transcript + computed facts) for blind hand-labelling,
// and data/labels/<group>-labels.csv as an empty template (never overwritten).
// Usage: npm run export:readable -- data/dev.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { computeFacts, renderFacts } from "../src/core/facts";
import { renderTranscript } from "../src/core/prompt";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { allowedAnswers } from "../src/core/scoring";
import { normaliseRecords } from "../src/server/service";

const file = process.argv[2] ?? "data/dev.json";
const group = (file.split("/").pop() ?? "dev").replace(/\.json$/, "");
const dialogues = normaliseRecords(JSON.parse(readFileSync(file, "utf8")));
mkdirSync("data/readable", { recursive: true });
mkdirSync("data/labels", { recursive: true });

const crit = DEFAULT_CHECKLIST.criteria;
const legend = crit.map((c) => `- ${c.id} ${c.title}: ${allowedAnswers(c).join(" | ")}`).join("\n");

for (const d of dialogues) {
  const f = computeFacts(d, DEFAULT_CHECKLIST.waitThresholdSec);
  const md = `# ${d.conversation_id} · ${d.channel} · ${d.language}${d.audio_url ? "\n\nЗапись: есть (слушать в карточке диалога)" : ""}

## Факты
${renderFacts(f)}

## Транскрипт
\`\`\`
${renderTranscript(d, f)}
\`\`\`

## Метки (ответы)
${legend}
`;
  writeFileSync(`data/readable/${d.conversation_id}.md`, md);
}

const csv = `data/labels/${group}-labels.csv`;
if (!existsSync(csv)) {
  const header = ["conversation_id", "language", "channel", ...crit.map((c) => c.id), "labeller", "note"].join(",");
  const rows = dialogues.map((d) => [d.conversation_id, d.language, d.channel, ...crit.map(() => ""), "", ""].join(","));
  writeFileSync(csv, [header, ...rows].join("\n") + "\n");
  console.log(`Label template: ${csv}`);
} else console.log(`Label file exists, not overwritten: ${csv}`);
console.log(`Readable transcripts: data/readable/ (${dialogues.length} files)`);
console.log(`Allowed values:\n${legend}`);
