// Writes checklists that replace one criterion, the way the organisers will at the control:
// a new wording, no hint, the same weight and section. Files go to tmp/rehearsal/ and feed
//   npm run harness -- --checklist tmp/rehearsal/<name>.json
//   npm run impact -- --base runs/<before>.json --run runs/<after>.json
// New criteria get new ids so the harness does not compare them with labels of the old ones.
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_CHECKLIST } from "../src/core/defaultChecklist";
import { validateChecklist } from "../src/core/scoring";
import type { Checklist, Criterion } from "../src/core/types";

type Replacement = Pick<Criterion, "id" | "title" | "description" | "answerType" | "naAllowed"> & Partial<Pick<Criterion, "steps" | "naCondition">>;

const REPLACEMENTS: Record<string, { replaces: string; criterion: Replacement }> = {
  "yesno-c05": {
    replaces: "c05",
    criterion: {
      id: "n05",
      title: "Проактивность",
      description: "Да — оператор по своей инициативе дал полезную информацию или предупредил о возможной проблеме, о которой клиент не спрашивал. Нет — в противном случае.",
      answerType: "yes_no",
      naAllowed: false,
    },
  },
  "scale-c06": {
    replaces: "c06",
    criterion: {
      id: "n06",
      title: "Понятность инструкций",
      description: "Оцените, насколько конкретно оператор объяснил, что делать клиенту.",
      answerType: "scale",
      naAllowed: false,
      steps: [
        { value: 0, description: "Инструкций нет или по ним нельзя действовать." },
        { value: 5, description: "Общее направление есть, но конкретные шаги клиенту приходится додумывать." },
        { value: 10, description: "Шаги конкретные, клиент может выполнить их без уточнений." },
      ],
    },
  },
  "na-c03": {
    replaces: "c03",
    criterion: {
      id: "n03",
      title: "Срок обратной связи",
      description: "Да — передавая вопрос на проверку, оператор назвал срок или способ получения ответа. Нет — вопрос передан без срока и способа.",
      answerType: "yes_no",
      naAllowed: true,
      naCondition: "Оператор не передавал вопрос на проверку.",
    },
  },
};

mkdirSync("tmp/rehearsal", { recursive: true });
for (const [name, { replaces, criterion }] of Object.entries(REPLACEMENTS)) {
  const cl: Checklist = {
    ...DEFAULT_CHECKLIST,
    id: `rehearsal-${name}`,
    name: `Репетиция: ${criterion.title}`,
    criteria: DEFAULT_CHECKLIST.criteria.map((c) =>
      c.id === replaces ? { code: c.code, sectionId: c.sectionId, weight: c.weight, isFlag: false, ...criterion } : c,
    ),
  };
  const problems = validateChecklist(cl);
  if (problems.length) throw new Error(`${name}: ${problems.join("; ")}`);
  writeFileSync(`tmp/rehearsal/${name}.json`, JSON.stringify(cl, null, 1));
  console.log(`tmp/rehearsal/${name}.json: ${replaces} -> ${criterion.id} «${criterion.title}»`);
}
