// Framework-free domain types shared by the UI, the server and the scripts.

export type Speaker = "client" | "operator" | "bot" | "system";

export interface Turn {
  timestamp: string;
  speaker: Speaker | string;
  text: string;
}

export interface Dialogue {
  conversation_id: string;
  channel: string; // "agent chat" | "voice call"
  language: string; // "RU" | "KZ" | "EN"
  transcript: Turn[];
  audio_url: string | null;
  group_id?: string;
}

export type AnswerType = "yes_no" | "scale";

export interface ScaleStep {
  value: number;
  description: string;
}

export interface Section {
  id: string;
  title: string;
}

export interface Criterion {
  /** Stable key, used as JSON property name in the model output. [A-Za-z0-9_-] only. */
  id: string;
  /** Display code, e.g. "01". */
  code: string;
  sectionId: string;
  title: string;
  /** What the criterion checks / when the answer is "Yes" (or how to pick a scale step). */
  description: string;
  answerType: AnswerType;
  /** Scale steps, required when answerType = "scale". The highest value gives the full weight. */
  steps?: ScaleStep[];
  naAllowed: boolean;
  /** When N/A applies (required when naAllowed). */
  naCondition?: string;
  /** Points before N/A redistribution. 0 for flags. */
  weight: number;
  /** A flag criterion (e.g. gross errors) gives no points; "yes" means the problem was found. */
  isFlag: boolean;
  /** Optional extra guidance for the evaluator. */
  guidance?: string;
}

export interface Checklist {
  id: string;
  name: string;
  version: number;
  sections: Section[];
  criteria: Criterion[];
  /** Global rules (FAQ + interpretations) injected into the evaluator prompt. */
  rules: string;
  /** First-reaction / reply wait threshold in seconds. */
  waitThresholdSec: number;
  isActive?: boolean;
  createdAt?: string;
}

/** "yes" | "no" | "na" for yes/no criteria, a step value for scale criteria (or "na"). */
export type Answer = "yes" | "no" | "na" | number;

export interface Judgment {
  criterionId: string;
  answer: Answer;
  explanation: string;
  evidenceTurnIds: number[];
  /** Inclusive turn range that was checked when an expected action is missing. */
  checkedSpan: [number, number] | null;
  naReason: string | null;
  confidence: "high" | "low";
  votes: Answer[];
}

export interface CriterionScore {
  criterionId: string;
  answer: Answer;
  weight: number;
  applicable: boolean;
  /** Raw points before redistribution (weight * fraction). */
  rawPoints: number;
  /** Points after N/A redistribution (sum over criteria = total). */
  points: number;
  /** Maximum attainable after redistribution. */
  maxPoints: number;
}

export interface SectionScore {
  sectionId: string;
  title: string;
  points: number;
  maxPoints: number;
  hasApplicable: boolean;
}

export interface ScoreResult {
  total: number | null;
  criteria: CriterionScore[];
  sections: SectionScore[];
  grossError: boolean;
  grossCriteria: string[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface EvaluationRecord {
  id: string;
  dialogueId: string;
  checklistId: string;
  checklistVersion: number;
  provider: string;
  model: string;
  samples: number;
  status: "done" | "error";
  error?: string | null;
  judgments: Judgment[];
  score: ScoreResult;
  usage: Usage;
  costUsd: number | null;
  latencyMs: number;
  createdAt: string;
}

export interface Appeal {
  id: string;
  evaluationId: string;
  dialogueId: string;
  criterionId: string;
  comment: string;
  status: "open" | "upheld" | "changed";
  createdAt: string;
  review?: Review | null;
}

export interface Review {
  id: string;
  appealId: string;
  decision: "upheld" | "changed";
  newAnswer: Answer | null;
  reason: string;
  reviewedAt: string;
}
