import type { Dialogue } from "./types";

/**
 * Deterministic, criterion-agnostic facts about a transcript.
 * They are shown to the evaluator model (so it does not have to do arithmetic on
 * timestamps) and to the user in the dialogue card.
 */

export type EndType =
  | "operator_closed"
  | "client_left"
  | "connection_lost"
  | "client_hung_up"
  | "none";

export interface TurnInfo {
  idx: number;
  speaker: string;
  /** Seconds since the first turn. */
  t: number;
  internal: boolean;
  duplicate: boolean;
  /** Offset into the call recording, seconds (voice only). */
  audioOffset: number | null;
}

export interface WaitGap {
  fromIdx: number; // client turn (or escalation event) that started the wait
  toIdx: number | null; // operator turn that ended it (null = never answered)
  seconds: number;
  warnedBefore: boolean;
}

export interface Facts {
  channel: "chat" | "voice";
  turnCount: number;
  durationSec: number;
  clientLanguage: "RU" | "KZ" | "EN" | "unknown";
  escalationIdx: number | null;
  firstOperatorIdx: number | null;
  firstOperatorBlock: number[];
  firstOperatorLanguage: "RU" | "KZ" | "EN" | "unknown";
  firstReactionSec: number | null;
  operatorTurnCount: number;
  waitThresholdSec: number;
  longWaits: WaitGap[];
  maxReplyGapSec: number | null;
  waitWarningIdx: number[];
  holdWindows: [number, number][];
  identityVerifiedIdx: number | null;
  verbalIdentificationIdx: number[];
  endType: EndType;
  endEventIdx: number | null;
  lastOperatorIdx: number | null;
  clientTurnsAfterLastOperator: number;
  duplicateIdx: number[];
  turns: TurnInfo[];
}

const RX = {
  escalation:
    /эскалац|операторға жіберілді|transferred to an agent|агент присоединился|оператор подключ|agent joined/i,
  identityVerified:
    /личность клиента подтвержд|жеке басы расталды|identity (has been )?verified|identity confirmed/i,
  verbalId:
    /идентификац|подтвердить личность|подтвердим личность|сәйкестендір|жеке басыңызды раста|identif|verify your identity/i,
  operatorClosed: /оператор закрыл чат|оператор чатты жапты|agent closed the chat|operator closed/i,
  clientLeft: /клиент покинул|клиент чаттан шықты|клиент шықты|customer left|client left/i,
  connectionLost: /соединение с клиентом прервано|байланыс үзілді|connection to customer lost|connection lost/i,
  clientHungUp: /клиент завершил разговор|клиент сөйлесуді аяқтады|customer ended/i,
  holdStart: /находится на удержании|ұстап тұр|on hold/i,
  holdEnd: /больше не находится на удержании|no longer on hold/i,
  consultStart: /инициирована консультация|началась консультация/i,
  consultEnd: /агент вышел из разговора|консультация завершена/i,
  recStart: /запись и транскрибирование запущены|жазу және транскрипция басталды|recording .*started/i,
  recPause: /приостановлены|тоқтатылды|paused/i,
  recResume: /возобновлены|жалғастырылды|resumed/i,
  waitWarning:
    /минут|секунд|ожида|подожд|на линии|сейчас (посмотр|провер|уточн)|провер(ю|им)|уточню|момент|күте тұр|күтіңіз|бір сәт|минут|тексер(іп|емін)|wait|hold on|one moment|a moment|let me check|i'?ll check|bear with/i,
};

const KZ_LETTERS = /[әғқңөұүһі]/i;
const CYR = /[а-яё]/i;
const LAT = /[a-z]/i;

export function detectLanguage(texts: string[]): "RU" | "KZ" | "EN" | "unknown" {
  const s = texts.join(" ");
  if (!s.trim()) return "unknown";
  const kz = (s.match(/[әғқңөұүһі]/gi) ?? []).length;
  const cyr = (s.match(/[а-яё]/gi) ?? []).length;
  const lat = (s.match(/[a-z]/gi) ?? []).length;
  if (cyr + kz === 0 && lat === 0) return "unknown";
  if (cyr + kz === 0) return "EN";
  // Capitalised Latin words in Cyrillic text are names of products and app sections, not language.
  const latWithoutNames = (s.replace(/\b[A-Z][A-Za-z'’-]*\b/g, " ").match(/[a-z]/gi) ?? []).length;
  if (latWithoutNames > cyr + kz) return "EN";
  // Kazakh-specific letters are a strong signal even when sparse
  if (kz >= 2 || (kz >= 1 && cyr < 40) || /\b(сәлеметсіз|рақмет|рахмет|сізге|қалай|иә|жоқ)\b/i.test(s))
    return "KZ";
  return "RU";
}

/** Seconds for MM:SS (or H:MM:SS) and ISO-8601 timestamps. */
export function toSeconds(ts: string): number | null {
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(ts.trim());
  if (m) {
    return m[3] !== undefined
      ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
      : Number(m[1]) * 60 + Number(m[2]);
  }
  // ISO with up to 7 fractional digits; JS Date handles ms precision only.
  const iso = ts.trim().replace(/(\.\d{3})\d+/, "$1");
  const d = Date.parse(iso);
  return Number.isFinite(d) ? d / 1000 : null;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function computeFacts(d: Dialogue, waitThresholdSec = 180): Facts {
  const T = d.transcript;
  const isVoice = /voice|call|звон/i.test(d.channel) || !!d.audio_url;
  const abs = T.map((t) => toSeconds(t.timestamp));
  const firstAbs = abs.find((x) => x !== null) ?? 0;
  // carry forward unknown timestamps
  let last = firstAbs;
  const rel = abs.map((x) => {
    if (x === null) return last - firstAbs;
    last = x;
    return x - firstAbs;
  });

  // hold / internal-consultation windows
  // A colleague can leave while the client is still on hold, so hold and consultation are tracked
  // separately and merged: the client hears the operator again only when both have ended.
  const rawWindows: [number, number][] = [];
  let holdOpen: number | null = null;
  let consultOpen: number | null = null;
  T.forEach((t, i) => {
    if (t.speaker !== "system") return;
    if (RX.holdEnd.test(t.text)) {
      if (holdOpen !== null) rawWindows.push([holdOpen, i]);
      holdOpen = null;
    } else if (RX.holdStart.test(t.text) && holdOpen === null) {
      holdOpen = i;
    } else if (RX.consultEnd.test(t.text)) {
      if (consultOpen !== null) rawWindows.push([consultOpen, i]);
      consultOpen = null;
    } else if (RX.consultStart.test(t.text) && consultOpen === null) {
      consultOpen = i;
    }
  });
  for (const open of [holdOpen, consultOpen]) if (open !== null) rawWindows.push([open, T.length - 1]);
  const holdWindows: [number, number][] = [];
  for (const [a, b] of rawWindows.sort((x, y) => x[0] - y[0])) {
    const last = holdWindows[holdWindows.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else holdWindows.push([a, b]);
  }
  const inHold = (i: number) => holdWindows.some(([a, b]) => i > a && i < b);

  // duplicates (consecutive identical turns)
  const duplicateIdx: number[] = [];
  for (let i = 1; i < T.length; i++) {
    if (
      T[i].speaker === T[i - 1].speaker &&
      T[i].text.trim() === T[i - 1].text.trim() &&
      T[i].timestamp === T[i - 1].timestamp
    )
      duplicateIdx.push(i);
  }
  const dupSet = new Set(duplicateIdx);

  // audio offsets (voice): recording time excludes paused intervals
  let audioOffsets: (number | null)[] = T.map(() => null);
  if (isVoice) {
    const startIdx = T.findIndex((t) => t.speaker === "system" && RX.recStart.test(t.text));
    const start = startIdx >= 0 ? rel[startIdx] : 0;
    let paused = 0;
    let pauseAt: number | null = null;
    audioOffsets = T.map((t, i) => {
      if (t.speaker === "system" && RX.recPause.test(t.text) && pauseAt === null) pauseAt = rel[i];
      if (t.speaker === "system" && RX.recResume.test(t.text) && pauseAt !== null) {
        paused += rel[i] - pauseAt;
        pauseAt = null;
      }
      const at = pauseAt !== null ? pauseAt : rel[i];
      return Math.max(0, at - start - paused);
    });
  }

  const turns: TurnInfo[] = T.map((t, i) => ({
    idx: i,
    speaker: t.speaker,
    t: Math.round(rel[i] * 10) / 10,
    internal: t.speaker === "operator" && inHold(i),
    duplicate: dupSet.has(i),
    audioOffset: audioOffsets[i] === null ? null : Math.round((audioOffsets[i] as number) * 10) / 10,
  }));

  const isOp = (i: number) => T[i].speaker === "operator" && !turns[i].internal;
  const opIdx = T.map((_, i) => i).filter(isOp);
  const firstOperatorIdx = opIdx.length ? opIdx[0] : null;
  const firstOperatorBlock: number[] = [];
  if (firstOperatorIdx !== null) {
    for (let i = firstOperatorIdx; i < T.length; i++) {
      if (T[i].speaker === "client") break;
      if (isOp(i)) firstOperatorBlock.push(i);
    }
  }

  const escalationIdx = (() => {
    const i = T.findIndex((t) => t.speaker === "system" && RX.escalation.test(t.text));
    return i >= 0 ? i : null;
  })();

  const firstReactionSec =
    firstOperatorIdx !== null && escalationIdx !== null && escalationIdx < firstOperatorIdx
      ? Math.round(rel[firstOperatorIdx] - rel[escalationIdx])
      : null;

  // wait-warnings by operator
  const waitWarningIdx = opIdx.filter((i) => RX.waitWarning.test(T[i].text));

  // reply gaps: from escalation (first reaction) and from each unanswered client turn
  // Client-waiting gaps: escalation -> first operator turn, and each client turn -> next
  // operator turn. Plus operator -> operator silences right after a wait warning (warned waits).
  const clientGaps: WaitGap[] = [];
  const warnedGaps: WaitGap[] = [];
  let pending: number | null =
    escalationIdx !== null && (firstOperatorIdx === null || escalationIdx < firstOperatorIdx)
      ? escalationIdx
      : null;
  let prevOp: number | null = null;
  for (let i = escalationIdx !== null ? escalationIdx + 1 : 0; i < T.length; i++) {
    if (T[i].speaker === "client" && pending === null) {
      pending = i;
    } else if (isOp(i)) {
      if (pending !== null) {
        const seconds = Math.round(rel[i] - rel[pending]);
        const p = pending;
        clientGaps.push({
          fromIdx: p,
          toIdx: i,
          seconds,
          warnedBefore: holdWindows.some(([a]) => a > p && a < i),
        });
        pending = null;
      } else if (prevOp !== null && waitWarningIdx.includes(prevOp)) {
        const seconds = Math.round(rel[i] - rel[prevOp]);
        if (seconds > waitThresholdSec) warnedGaps.push({ fromIdx: prevOp, toIdx: i, seconds, warnedBefore: true });
      }
      prevOp = i;
    }
  }
  if (pending !== null) {
    clientGaps.push({
      fromIdx: pending,
      toIdx: null,
      seconds: Math.round(rel[T.length - 1] - rel[pending]),
      warnedBefore: false,
    });
  }
  const answeredGaps = clientGaps.filter((g) => g.toIdx !== null);
  const maxReplyGapSec = answeredGaps.length ? Math.max(...answeredGaps.map((g) => g.seconds)) : null;
  const longWaits = [...clientGaps.filter((g) => g.seconds > waitThresholdSec), ...warnedGaps].sort(
    (a, b) => a.fromIdx - b.fromIdx,
  );

  const identityVerifiedIdx = (() => {
    const i = T.findIndex((t) => t.speaker === "system" && RX.identityVerified.test(t.text));
    return i >= 0 ? i : null;
  })();
  const verbalIdentificationIdx = T.map((t, i) => i).filter(
    (i) => T[i].speaker === "operator" && RX.verbalId.test(T[i].text),
  );

  // end of conversation
  let endType: EndType = "none";
  let endEventIdx: number | null = null;
  for (let i = T.length - 1; i >= 0 && i >= T.length - 4; i--) {
    if (T[i].speaker !== "system") continue;
    const x = T[i].text;
    const k: EndType | null = RX.operatorClosed.test(x)
      ? "operator_closed"
      : RX.clientLeft.test(x)
        ? "client_left"
        : RX.connectionLost.test(x)
          ? "connection_lost"
          : RX.clientHungUp.test(x)
            ? "client_hung_up"
            : null;
    if (k) {
      endType = k;
      endEventIdx = i;
      break;
    }
  }
  const lastOperatorIdx = opIdx.length ? opIdx[opIdx.length - 1] : null;
  const clientTurnsAfterLastOperator =
    lastOperatorIdx === null
      ? T.filter((t) => t.speaker === "client").length
      : T.slice(lastOperatorIdx + 1).filter((t) => t.speaker === "client").length;

  const clientTexts = T.filter((t) => t.speaker === "client").map((t) => t.text);

  return {
    channel: isVoice ? "voice" : "chat",
    turnCount: T.length,
    durationSec: Math.round(rel[T.length - 1] ?? 0),
    clientLanguage: detectLanguage(clientTexts),
    escalationIdx,
    firstOperatorIdx,
    firstOperatorBlock,
    firstOperatorLanguage: detectLanguage(firstOperatorBlock.map((i) => T[i].text)),
    firstReactionSec,
    operatorTurnCount: opIdx.length,
    waitThresholdSec,
    longWaits,
    maxReplyGapSec,
    waitWarningIdx,
    holdWindows,
    identityVerifiedIdx,
    verbalIdentificationIdx,
    endType,
    endEventIdx,
    lastOperatorIdx,
    clientTurnsAfterLastOperator,
    duplicateIdx,
    turns,
  };
}

const END_LABEL: Record<EndType, string> = {
  operator_closed: "оператор закрыл чат",
  client_left: "клиент покинул чат",
  connection_lost: "соединение прервано",
  client_hung_up: "клиент завершил разговор",
  none: "нет системного события завершения",
};

/** Compact, human-readable facts block for the prompt. */
export function renderFacts(f: Facts): string {
  const L: string[] = [];
  L.push(`- Канал: ${f.channel === "voice" ? "звонок (ASR-расшифровка)" : "чат"}; реплик: ${f.turnCount}; длительность: ${formatClock(f.durationSec)}.`);
  L.push(`- Язык клиента (по его репликам): ${f.clientLanguage}. Язык первого ответа оператора: ${f.firstOperatorLanguage}.`);
  L.push(
    `- Эскалация на оператора: ${f.escalationIdx !== null ? `реплика [${f.escalationIdx}]` : "нет события"}. Первый ответ оператора: ${
      f.firstOperatorBlock.length ? `реплики [${f.firstOperatorBlock.join(", ")}]` : "оператор не отвечал"
    }.`,
  );
  // Reply times and the 3-minute threshold stay out of the prompt: the checklist excludes them from scoring.
  if (f.waitWarningIdx.length) L.push(`- Реплики оператора, где возможно предупреждение об ожидании или проверке: [${f.waitWarningIdx.join(", ")}].`);
  if (f.holdWindows.length)
    L.push(`- Удержание / консультация с коллегой: ${f.holdWindows.map(([a, b]) => `[${a}]–[${b}]`).join(", ")} (реплики оператора внутри — INTERNAL).`);
  L.push(
    `- Системное подтверждение личности: ${f.identityVerifiedIdx !== null ? `реплика [${f.identityVerifiedIdx}]` : "нет"}${
      f.verbalIdentificationIdx.length ? `; оператор упоминает идентификацию: [${f.verbalIdentificationIdx.join(", ")}]` : ""
    }.`,
  );
  L.push(
    `- Завершение: ${END_LABEL[f.endType]}${f.endEventIdx !== null ? ` [${f.endEventIdx}]` : ""}; последняя реплика оператора: ${
      f.lastOperatorIdx !== null ? `[${f.lastOperatorIdx}]` : "—"
    }; реплик клиента после неё: ${f.clientTurnsAfterLastOperator}.`,
  );
  if (f.duplicateIdx.length) L.push(`- Дубли реплик (артефакт расшифровки): [${f.duplicateIdx.join(", ")}].`);
  return L.join("\n");
}
