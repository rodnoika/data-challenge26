// Writes three new checklists for the robustness test (traps-v3) to data/synthetic/checklists/.
// No evaluator guidance on purpose: the judges will hand over wording only.
//   npx tsx scripts/make-v3-checklists.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_RULES } from "../src/core/defaultChecklist";
import { validateChecklist } from "../src/core/scoring";
import type { Checklist } from "../src/core/types";

const base = { version: 1, rules: DEFAULT_RULES, waitThresholdSec: 180 };

const compliance: Checklist = {
  ...base,
  id: "v3-compliance",
  name: "Комплаенс и безопасность",
  sections: [
    { id: "s1", title: "Безопасность данных" },
    { id: "s2", title: "Корректность консультации" },
    { id: "s3", title: "Грубые нарушения" },
  ],
  criteria: [
    { id: "a1", code: "A1", sectionId: "s1", title: "Идентификация перед данными счёта", answerType: "yes_no", weight: 20, isFlag: false,
      description: "Да — оператор сообщал данные счёта клиента (баланс, позиции, статус поручения или платежа) только после подтверждения личности. Нет — сообщил до подтверждения.",
      naAllowed: true, naCondition: "Данные конкретного счёта в диалоге не сообщались." },
    { id: "a2", code: "A2", sectionId: "s1", title: "Запрос только допустимых данных", answerType: "yes_no", weight: 20, isFlag: false,
      description: "Да — оператор не просил у клиента пароль, SMS-код, CVV или полный номер карты. Нет — попросил хотя бы одно из этого.",
      naAllowed: false },
    { id: "a3", code: "A3", sectionId: "s2", title: "Предупреждение о рисках", answerType: "scale", weight: 20, isFlag: false,
      description: "Оцените, как оператор говорил о рисках, когда речь шла о вложениях или сделках.",
      steps: [
        { value: 0, description: "Обещал или гарантировал доходность." },
        { value: 5, description: "Доходность не обещал, но о рисках не упомянул, хотя клиент спрашивал, куда или во что вложить." },
        { value: 10, description: "Упомянул риски или прямо сказал, что доходность не гарантирована." },
      ],
      naAllowed: true, naCondition: "Клиент не спрашивал о вложениях, доходности или выборе инструмента." },
    { id: "a4", code: "A4", sectionId: "s2", title: "Без индивидуальных рекомендаций", answerType: "yes_no", weight: 20, isFlag: false,
      description: "Да — оператор не советовал клиенту купить или продать конкретный инструмент как личную рекомендацию. Нет — посоветовал.",
      naAllowed: true, naCondition: "Клиент не просил совета, что купить или продать." },
    { id: "a5", code: "A5", sectionId: "s2", title: "Обещания и сроки", answerType: "yes_no", weight: 20, isFlag: false,
      description: "Да — сроки и суммы, которые назвал оператор, конкретны и не противоречат друг другу. Нет — оператор гарантировал то, что от него не зависит, или назвал противоречивые сроки.",
      naAllowed: true, naCondition: "Оператор не называл сроков и сумм." },
    { id: "aF", code: "AF", sectionId: "s3", title: "Грубые нарушения", answerType: "yes_no", weight: 0, isFlag: true,
      description: "Да — оскорбление клиента, предложение перевести деньги лично оператору или оказать частную платную услугу, либо просьба сообщить пароль или SMS-код. Нет — ничего из этого.",
      naAllowed: false },
  ],
};

const cx: Checklist = {
  ...base,
  id: "v3-cx",
  name: "Клиентский опыт",
  sections: [
    { id: "s1", title: "Контакт" },
    { id: "s2", title: "Помощь" },
    { id: "s3", title: "Грубые нарушения" },
  ],
  criteria: [
    { id: "b1", code: "B1", sectionId: "s1", title: "Обращение по имени", answerType: "yes_no", weight: 10, isFlag: false,
      description: "Да — оператор хотя бы раз обратился к клиенту по имени. Нет — имя было известно, но оператор ни разу его не использовал.",
      naAllowed: true, naCondition: "Имя клиента в диалоге не прозвучало и системой не передано." },
    { id: "b2", code: "B2", sectionId: "s1", title: "Эмпатия", answerType: "scale", weight: 20, isFlag: false,
      description: "Оцените реакцию оператора на недовольство или неудобство клиента.",
      steps: [
        { value: 0, description: "Упрёк, пренебрежение или сарказм в ответ на проблему." },
        { value: 1, description: "Вежливо, но шаблонно: на саму проблему не отреагировал." },
        { value: 2, description: "Отреагировал на конкретную проблему клиента." },
        { value: 3, description: "Отреагировал и сам предложил, как уменьшить неудобство (сверх ответа на вопрос)." },
      ],
      naAllowed: true, naCondition: "Клиент не выражал недовольства и не описывал неудобств." },
    { id: "b3", code: "B3", sectionId: "s2", title: "Понятность инструкций", answerType: "scale", weight: 25, isFlag: false,
      description: "Оцените, насколько конкретно оператор объяснил клиенту, что делать.",
      steps: [
        { value: 0, description: "Инструкций нет или по ним нельзя действовать." },
        { value: 5, description: "Направление есть, но шаги клиенту приходится додумывать." },
        { value: 10, description: "Шаги конкретные, клиент выполнит их без уточнений." },
      ],
      naAllowed: true, naCondition: "Клиенту не нужно было ничего делать самому." },
    { id: "b4", code: "B4", sectionId: "s2", title: "Проактивность", answerType: "yes_no", weight: 15, isFlag: false,
      description: "Да — оператор по своей инициативе дал полезную информацию или предупредил о возможной проблеме, о которой клиент не спрашивал. Нет — в противном случае.",
      naAllowed: false },
    { id: "b5", code: "B5", sectionId: "s2", title: "Итог в конце", answerType: "yes_no", weight: 15, isFlag: false,
      description: "Да — в конце диалога оператор кратко повторил результат или что будет дальше. Нет — не повторил.",
      naAllowed: true, naCondition: "Клиент ушёл или связь прервалась до завершения." },
    { id: "b6", code: "B6", sectionId: "s2", title: "Язык клиента", answerType: "yes_no", weight: 15, isFlag: false,
      description: "Да — оператор весь диалог отвечал на языке клиента и переходил на другой язык вслед за клиентом. Нет — хотя бы раз ответил не на языке клиента без его просьбы.",
      naAllowed: false },
    { id: "bF", code: "BF", sectionId: "s3", title: "Грубые нарушения", answerType: "yes_no", weight: 0, isFlag: true,
      description: "Да — оскорбление или унижение клиента либо раскрытие данных другого клиента. Нет — ничего из этого.",
      naAllowed: false },
  ],
};

const express: Checklist = {
  ...base,
  id: "v3-express",
  name: "Экспресс-чек",
  waitThresholdSec: 120,
  sections: [
    { id: "s1", title: "Результат" },
    { id: "s2", title: "Грубые нарушения" },
  ],
  criteria: [
    { id: "x1", code: "X1", sectionId: "s1", title: "Решение с первого контакта", answerType: "yes_no", weight: 40, isFlag: false,
      description: "Да — вопрос клиента решён в этом диалоге, без перевода на другого специалиста и без просьбы обратиться позже. Нет — не решён, переведён или отложен.",
      naAllowed: true, naCondition: "Клиент ушёл до того, как сформулировал вопрос." },
    { id: "x2", code: "X2", sectionId: "s1", title: "Скорость первой реакции", answerType: "yes_no", weight: 20, isFlag: false,
      description: "Да — первая реплика оператора появилась не позже чем через 2 минуты после перевода чата на оператора. Нет — позже.",
      naAllowed: false },
    { id: "x3", code: "X3", sectionId: "s1", title: "Тон", answerType: "scale", weight: 25, isFlag: false,
      description: "Оцените тон оператора за весь диалог.",
      steps: [
        { value: 1, description: "Грубый или раздражённый." },
        { value: 2, description: "Сухой, есть резкие формулировки." },
        { value: 3, description: "Нейтральный, вежливый." },
        { value: 4, description: "Вежливый и доброжелательный." },
        { value: 5, description: "Тёплый и профессиональный на протяжении всего диалога." },
      ],
      naAllowed: false },
    { id: "x4", code: "X4", sectionId: "s1", title: "Прощание", answerType: "yes_no", weight: 15, isFlag: false,
      description: "Да — оператор попрощался с клиентом. Нет — закрыл диалог без прощания.",
      naAllowed: true, naCondition: "Клиент ушёл или связь прервалась до того, как оператор мог попрощаться." },
    { id: "xF", code: "XF", sectionId: "s2", title: "Грубые нарушения", answerType: "yes_no", weight: 0, isFlag: true,
      description: "Да — оскорбление клиента, предложение платной услуги в обход компании или раскрытие конфиденциальной информации. Нет — ничего из этого.",
      naAllowed: false },
  ],
};

mkdirSync("data/synthetic/checklists", { recursive: true });
for (const cl of [compliance, cx, express]) {
  const errs = validateChecklist(cl);
  if (errs.length) throw new Error(`${cl.id}: ${errs.join("; ")}`);
  const w = cl.criteria.reduce((s, c) => s + c.weight, 0);
  writeFileSync(`data/synthetic/checklists/${cl.id}.json`, JSON.stringify(cl, null, 2));
  console.log(`data/synthetic/checklists/${cl.id}.json · ${cl.criteria.length} критериев · сумма весов ${w}`);
}
