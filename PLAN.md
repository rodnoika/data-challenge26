# CQA Hackathon: build plan (becomes `PLAN.md` in the repo after approval)

## Context
This is the Freedom Broker x NU Data Challenge: a 24h build of a Conversation Quality Analytics prototype. The clock started on 7 Nov 12:00 (UTC+5). Control transcripts arrive 8 Nov 11:00, stop-code is 12:00 and the pitch is 13:00. **Accuracy against the organisers' ground truth on 10 unseen dialogues is the main criterion.** The secondary criteria are full Contour 1 + 2 functionality, usability, honest processing (no replayed results) and a live "replace a criterion and re-run" check.

Team: 2 people. **Z** is full-stack, Next.js/Svelte, reads Kazakh, and works with Claude Code. **T** is the teammate, strongest at Python/ML/data. We have Anthropic, OpenAI and Gemini keys, an M4 Mac with 24 GB, Next.js only, and the demo runs locally. All 65 DEV dialogues get hand-labelled. Chosen extras: batch run + dashboard, and self-consistency confidence. **The evaluation model is chosen by a benchmark on those labels (§6a), not by default.**

Plan-mode note: `data/dev.json` is currently in the scratchpad (fetched OK: 222 KB, 65 records). It is copied into the repo, and this file is copied to `PLAN.md`, as the first step after approval.

---

## 1. DEV data findings
- 65 records with clean schema; every turn has `{timestamp, speaker, text}`. Breakdown: RU chat 30, KZ chat 15, EN chat 15, RU voice 5 (`p4-ru-001..005`). The **5 calls are inside the 35 RU**. There are **no reference labels or scores** in the payload.
- Speakers: client 505, operator 339, bot 315, system 109 turns. Chats run 11–32 turns (median 14). Calls run 45–115.
- **Chat template:** client asks → bot greeting + privacy notice → bot answer → client asks for a human → bot confirms → system "escalated" (turn 8) → operator from turn 9/10. Sometimes the client writes again between escalation and the operator joining (ru-003, ru-010).
- **26 distinct system messages.** They fall into these groups:
  - escalation: `Эскалация на оператора.` / `Чат операторға жіберілді.` / `Chat transferred to an agent.` / `Агент присоединился…`
  - **identity verified:** `Личность клиента подтверждена.` / `Клиенттің жеке басы расталды.` / `Customer identity verified.` (ru-006, ru-010, kz-003, en-006)
  - endings: `Оператор закрыл чат` (+KZ/EN), `Клиент покинул чат`, `Соединение с клиентом прервано` (+KZ/EN), `Клиент завершил разговор` (calls)
  - call-only: recording started/paused/resumed (RU and KZ), IVR language switch kk→ru, `Клиент находится на удержании` / `…больше не…`, `Инициирована/Началась консультация с агентом`, `Агент вышел из разговора`, transfer to support.
- **Timing:** chats use `MM:SS` from 00:00, calls use ISO with 7-digit fractions and `+00:00`. Escalation→first-operator gaps range 19–134 s. The max client→operator reply gap is 162 s. **No dialogue in DEV crosses the 3-minute threshold**, but the control set may, so the logic must exist without DEV coverage.
- **Gross errors present in DEV:** ru-022 ("send money to my card"), ru-023 ("give me your personal number, paid private consultation"), kz-013, en-013. Other edge cases:
  - ru-018: wrong, curt answer, then "operator closed chat" with no goodbye
  - ru-025: client left before stating a request (04 should be N/A)
  - ru-012 and en-009: connection lost (07 should be N/A)
- **Voice call quirks:**
  - ASR is noisy: garbled IVR, "Пирас/Перрас".
  - PII is redacted (`[Имя скрыто]`, `[Персональные данные скрыты]`, `[Данные идентификации скрыты]`). A redacted name after "меня зовут" should count as an introduction.
  - Consecutive duplicate turns occur (13 in total).
  - Identification in calls is **verbal** (full name + SMS code + "идентификация успешно пройдена"), with no system event.
  - **In p4-ru-002, the operator consults a colleague while the client is on hold, and those turns are also labelled `operator`.** p4-ru-002 is also a callback that starts mid-conversation.
- **The recording link is an HTML player page, not audio.** It embeds `<audio><source src="https://freedomholdingcorporation.crm11.dynamics.com/api/filedownload/...">`, and that URL returns `audio/mpeg` with HTTP Range support (206). So the backend can resolve the page → mp3 and proxy it with Range, which lets the UI seek to the evidence fragment.

## 2. Ambiguities and the interpretation we will use
Each interpretation goes into the criterion text or the "rules" block of the prompt, so the jury can see it in the editor. Items marked ★ get cross-checked against the hand labels and flipped if the labels disagree.

1. **Whose work is scored.** Only `operator` turns. Bot and system turns are context. Operator turns between `Клиент находится на удержании` and `…больше не находится` (or between `Инициирована консультация` and `Агент вышел`) are **internal consultation**. They are marked `internal` and excluded from client-facing judgments (greeting, literacy, wait).
2. **"First reply" (01).** The first block of consecutive operator turns before the next client turn. The bot greeting never counts. A redacted name (`[Имя скрыто]`) counts as introducing oneself. "Client's language" means the language of the client's own messages (computed), not the record's `language` field. Calls switch kk→ru in the IVR, and the client then speaks RU.
3. **First reaction, 3 minutes.** Measured from escalation (or the client's first message after escalation, whichever is later) to the first operator turn. Also measured from each client message to the next operator turn. A gap over 180 s with no warning before it is a "noticeable failure" in **06**, which caps it at 7. 06 is the only criterion that mentions speed.
4. **Explicit wait (06).** Any of: an operator warning ("минуту", "ожидайте", "проверю", "сейчас посмотрю", KZ/EN equivalents), a hold system event, or a computed gap over 180 s. If a wait happened and no warning came before it, 06 is at most 7.
5. **Identification (03).** In chats, the verified-identity system event is the hard signal. In calls, the confirmation must be verbal. A protected action or disclosure means account-specific facts (payment status, positions, orders, balances, personal-data changes). General product or how-to questions are N/A. ★ The operator mentions verification, the client declines, and nothing protected is disclosed (ru-002): we score **N/A**. Something protected disclosed with no confirmation is **No**.
6. **Need identification (02).** **N/A** when the request was fully clear from the client's and bot's history. **Yes** when something was missing and the operator asked before answering. **No** when the operator answered without needed details (ru-018) or ignored details already given (ru-003). Messages to the bot before escalation count as "known details".
7. **Consultation (04).** N/A only if the conversation ends before the client states any request, including to the bot (ru-025). A correct handoff ("passed to specialists, we'll reply here") counts as a "correct next step" and earns 20.
8. **Closing (07).** **Yes** needs a summary or an offer of further help, plus a goodbye. Anything else is **No**, including "operator closed chat" without a goodbye (the PDF's own example) and a bare goodbye. Client left or connection lost before a natural end is **N/A**. In calls, a client hang-up while the operator is mid-answer is N/A.
9. **Empathy (05).** Baseline politeness is required. If the client voiced dissatisfaction or an inconvenience, the operator must address that specific problem, not just say a generic "sorry".
10. **Gross errors (08).** A flag only. **It does not zero the total**: the PDF says "отметьте отдельно". It is shown as a red banner with the evidence turn. The offer alone is enough.
11. **Literacy in calls.** ASR errors must not count against 06. The prompt says the call is an ASR transcript.
12. **Sections.** The PDF headings define the sections: S1 "Начало и понимание запроса" (01, 02 = 25), S2 "Безопасность и решение" (03, 04 = 40), S3 "Ведение и завершение" (05, 06, 07 = 35), S4 "Грубые нарушения" (08, flag). Each section subtotal is the sum of its redistributed points, shown as points over the section's redistributed maximum.
13. **Rounding.** Criterion points are stored unrounded and shown to 2 decimals. Only the total is rounded to 2 decimals. If no weighted criterion applies, the total is `null` and shown as "not calculated".
14. **Duplicates.** Original turns are kept with their timestamps, as the brief requires. Consecutive exact duplicates are shown as "duplicate" and collapsed in the prompt.
15. **Accuracy metric (unknown).** We optimise both per-criterion exact match and total-score MAE, and report both.

## 3. Architecture
One Next.js 15 (App Router, TS) project:

```
app/                      UI: all pages "use client"; no server components that fetch data
  page.tsx                Dialogues list + batch run + dashboard
  dialogue/page.tsx       Card: ?id=…  (query param, NOT [id], so static export works)
  checklists/page.tsx     Checklist editor
  appeals/page.tsx        Reviewer queue
  api/**/route.ts         Thin adapters → src/server/*
src/core/                 Pure, framework-free TS (unit-tested)
  types.ts                Criterion, Checklist, Dialogue, Judgment, EvalResult
  facts.ts                Deterministic transcript facts
  scoring.ts              Points, N/A redistribution, sections, rounding
  prompt.ts               Prompt built ONLY from checklist JSON + FAQ rules
  aggregate.ts            Self-consistency vote
src/server/               Node-only: db.ts (SQLite), providers/, evaluator.ts, organiserApi.ts, audio.ts
src/ui/                   Components + lib/api.ts (all fetches use NEXT_PUBLIC_API_BASE, default "")
scripts/                  fetch-dataset.ts, harness.ts, export-readable.ts, labels-to-json.ts
data/                     dev.json, labels/dev-labels.csv, checklists/default.json
runs/                     Harness outputs (JSON + CSV, analysed by T in pandas)
```

- **Storage:** SQLite through `better-sqlite3` (synchronous, one file `data/cqa.db`). The fallback is `node:sqlite` if the native build misbehaves.
- **Providers:** one vendor-neutral interface with equal adapters for `anthropic`, `openai`, `gemini` and `ollama` (local). No provider is "primary". Provider and model come from config, are selectable in the UI settings, and are stored with every result. See §6a.
- **Evaluation model: not chosen yet.** It is picked by the benchmark in §6a on our labelled DEV data. Until then the configured default is only a placeholder for development, and nothing in the pitch or README names a model as "the" judge before the numbers exist.

## 4. Data model (SQLite, JSON columns)
- `dialogues(id PK, group_id, channel, language, transcript JSON, audio_url, source 'api'|'upload', fetched_at)`
- `checklists(id, name, version, criteria JSON, rules TEXT, is_active, created_at)`. Every save creates a new version, and evaluations point at the exact version.
- `Criterion = {id, code, section, title, yesCondition, noGuidance?, naAllowed, naCondition?, answerType:'yes_no'|'scale', steps?:[{value, description}], weight, isFlag, order}`
- `evaluations(id, dialogue_id, checklist_id, checklist_version, provider, model, samples INT, status, facts JSON, judgments JSON, raw JSON, total REAL NULL, gross_flag BOOL, cost_usd, input_tokens, output_tokens, latency_ms, created_at)`
- `Judgment = {criterionId, answer:'yes'|'no'|'na'|<step>, explanation, evidenceTurnIds[], checkedSpan?:[from,to], naReason?, confidence:'high'|'low', votes[]}`
- `appeals(id, evaluation_id, criterion_id, comment, status 'open'|'upheld'|'changed', created_at)`
- `reviews(id, appeal_id, decision, new_answer, reason, reviewed_at)`
- The final result is the original judgments with review overrides applied, run through `scoring.ts`. The card shows original → decision → final.
- `batch_jobs(id, group_id, checklist_id, total, done, failed, status)`

## 5. API (Route Handlers → `src/server`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/datasets/fetch` `{groupId}` | Proxy the organiser API (no CORS), upsert dialogues |
| POST | `/api/dialogues/upload` | Paste or upload a JSON record or array |
| GET | `/api/dialogues?group=&lang=&channel=` / `/api/dialogues/:id` | List / one, with latest evaluation summary |
| GET/POST | `/api/checklists`, GET/PUT `/api/checklists/:id`, POST `/api/checklists/:id/activate` | Editor CRUD |
| POST | `/api/evaluations` `{dialogueId, checklistId?}` | Run one evaluation |
| POST/GET | `/api/batches` `{groupId}` / `/api/batches/:id` | Batch run with concurrency 4–6 + progress polling |
| GET | `/api/evaluations/:id` | Full result |
| POST/GET | `/api/appeals`, POST `/api/appeals/:id/review` | Appeal and decision; triggers recalculation |
| GET | `/api/audio/:dialogueId` | Resolve HTML player → mp3, stream with Range |
| GET | `/api/export?group=` | CSV/JSON of final results (backup for the jury, harness input) |

## 6. Evaluation design
1. **Facts (`facts.ts`, deterministic, criterion-agnostic):**
   - turn index table, first operator block, client language (script + stopwords), escalation turn
   - first-reaction seconds, per-reply gaps and `>180s` flags, wait-warning phrases found
   - hold/consultation windows → internal turns, identity-verified event index
   - end type (operator closed / client left / connection lost / client hung up / natural)
   - duplicate turns, whether the client stated a request and where
   
   Facts are injected as a compact block. They are generic, so a replaced criterion still benefits.
2. **Prompt (`prompt.ts`), generated entirely from data:**
   - system: role, the rules block (FAQ text plus §2 interpretations, editable in the editor as checklist `rules`), and the criteria rendered from JSON (yes condition, N/A condition, scale steps)
   - user: the facts block and the transcript as `[i] mm:ss SPEAKER: text`, with internal turns tagged
   - The output JSON schema is generated from the criteria: an `answer` enum per criterion built from its type and N/A availability, plus `evidence_turn_ids`, `checked_span`, `na_reason` and a short `explanation` in the dialogue's language (RU UI default).
   
   The model **never computes points**. The prompt text is identical for every provider, and it uses no vendor-only features (no prefill, no vendor tags, no tool calls).
3. **Validation:** the schema is enforced by structured outputs. On top of that, code checks:
   - turn ids are in range
   - N/A is used only where allowed, otherwise the criterion is re-asked once
   - an `evidence_turn_id` for 01 that is not an operator turn gets low confidence
   
   Hard fact overrides are kept minimal and visible. For example, "identity verified event + account data disclosed after it" makes 03 ≠ No. Each override is logged in the result as "rule".
4. **Self-consistency:** N samples (default 3, setting 1–5, run in parallel). Yes/No/N/A uses the majority. Scales use the median step. Any disagreement sets `confidence: low` and a "needs review" badge. N=1 vs N=3, and a cross-vendor ensemble (one vote from each of three vendors), are both candidates in the §6a benchmark. Neither is a default until it wins there.
5. **Scoring (`scoring.ts`):**
   - points = weight × (yes ? 1 : 0), or weight × step / maxStep for scales
   - applicable = non-N/A criteria with weight > 0
   - total = Σ points × 100 / Σ applicable weights, rounded to 2 decimals (null if empty)
   - sections use the same factor
   - flags (isFlag) never add points
   
   This is unit-tested against hand-computed cases, including all-N/A, a new criterion, a changed scale, and weights not summing to 100.
6. **Cost per evaluation (README + UI):**
   - Each call's real token usage (input, cached input, output including reasoning tokens) is stored per evaluation.
   - Cost = tokens × the per-token prices in the model registry (§6a). A model with no checked price shows cost "unknown", never a guess.
   - Expected volume for a chat is ~5k input and ~1–4k output tokens per vote. Calls are 2–3× longer.
   - The README states the chosen model, the measured mean cost per evaluation on DEV (all calls and votes included), and the date the prices were checked.

## 6a. Model selection by benchmark
**Why:** accuracy against the organisers' ground truth is the main ranking criterion. We have no evidence yet that any vendor's model grades RU/KZ/EN support chats against this checklist better than the others. There is also a specific bias risk: an Anthropic model (Claude Code) originally proposed Anthropic models as the default. So the choice is made by measurement on our labelled data, with the same prompt for every candidate.

1. **Provider interface (`src/server/providers.ts`):**
   - Input: `judge({ system, user, schema, model, reasoning })`.
   - Output: `{ json, text, usage, latencyMs, model }`.
   - `reasoning` is a neutral `low | medium | high`. Each adapter maps it to its vendor's own control (Anthropic effort, OpenAI reasoning effort, Gemini thinking level/budget). The Ollama adapter ignores it.
   - Adapters only do transport, plus transport retries on 429/5xx. Parsing, validation and the single re-ask on invalid output live in shared code (`evaluator.ts`), so every provider gets identical treatment.
2. **Portable structured output:**
   - The JSON schema is generated from the checklist and kept to the subset that every vendor's strict mode accepts: objects, string enums, integer arrays, all fields required, `additionalProperties: false`. No `anyOf`, nullable types or numeric bounds.
   - Each adapter enforces the schema through its vendor's own mechanism: Anthropic `output_config.format`, OpenAI Responses `text.format` with `strict`, Gemini `responseJsonSchema`, Ollama `format`.
   - Vendor-only extras are off: no refusal fallbacks, no vendor tools. Prompt caching is used only where it is transparent and does not change the prompt (explicit on Anthropic, automatic on OpenAI/Gemini). Measured cost includes whatever caching each vendor actually applied.
3. **Model registry (`config/models.json`):**
   - Fields per entry: `provider, model, tier (frontier | cheap | local), priceIn, priceCachedIn, priceOut, priceSource (URL), checkedAt`.
   - The UI settings pick from this list, and cost is computed from it.
   - **Model IDs and prices are filled in from each vendor's official pricing page at the time of the benchmark, with the date.** They are not taken from memory, because they change often.
4. **Shortlist:** at least one frontier-tier and one cheap-tier model per cloud vendor, plus one local model.
   - Anthropic: frontier + cheap
   - OpenAI: frontier + cheap (mini/nano class)
   - Google: frontier (Pro class) + cheap (Flash class)
   - Local via Ollama on the M4 24 GB: one ~12–14B instruction model that supports JSON-schema output
   - Optional: a mid-tier model per vendor if budget allows, the best model with N=3, and a cross-vendor 3-vote ensemble
5. **Protocol (`npm run bench`, built on the harness):**
   - Every candidate runs the **same prompt version and checklist version**, with N=1 and `reasoning: medium`, on the same split.
   - Before any API calls, the harness prints the projected cost from the registry and asks for confirmation above $5.
   - **Fairness of prompt tuning:** tuning the rules on one model's mistakes would favour that model. So rules/prompt iterations are driven by disagreements seen across at least two vendors. The prompt version is frozen before the final bake-off.
   - The final bake-off runs on the **hold-out split** (20 dialogues), which tuning never touched.
6. **Metrics per candidate:**
   - mean per-criterion exact agreement, with a 95% bootstrap interval
   - per-criterion agreement
   - total-score MAE
   - gross-error recall and false positives
   - KZ-only agreement
   - invalid-output rate (before the re-ask)
   - measured cost per dialogue
   - p50/p95 latency
7. **Decision rule:**
   - Hard gates: every DEV gross error must be caught, and the invalid-output rate must be < 5%.
   - Then: highest mean agreement on the hold-out within the cost cap.
   - Differences inside the bootstrap interval (roughly ±3 pp with n≈160 criterion judgments) count as ties. Ties go to lower cost, then lower latency.
   - The winner becomes the configured default. The runner-up from **another vendor** is configured as the fallback for the 11:00 run.
   - Cost cap: set by the team before the run (proposal: ≤ $0.15 per evaluation including all votes; the 10 control dialogues are cheap either way, but tuning runs are not).
8. **Demo asset:**
   - The bench writes `benchmarks/<date>.json` (summary only: metrics and model metadata, no transcripts or URLs). The final one is committed.
   - A **"Сравнение моделей"** page (`/models`) shows the table and marks the chosen default and the local model. It answers the jury's "why this model and what does one evaluation cost" in one screen. The same table goes on a backup slide.

## 7. Accuracy harness (owned by T)
- `scripts/export-readable.ts` writes `data/readable/<id>.md` with numbered turns and the facts block, plus `data/labels/dev-labels.csv` with columns `conversation_id, c01..c08, note` and the allowed values.
- **Blind labelling:** labellers do not see model output. **T labels RU chats + calls (35) and EN (15); Z labels KZ (15).** Ambiguous cases ★ are discussed and the interpretation is written into the rules block.
- `scripts/harness.ts --provider --model --samples --ids` runs the real evaluator on DEV (no DB needed) and writes `runs/<ts>.json` and `.csv`. It reports:
  - per-criterion exact match and a Yes/No/N/A confusion matrix
  - scale exact and ±1-step agreement
  - total MAE
  - per-language and channel breakdown
  - gross-error precision/recall, cost and latency
- The same harness drives the model benchmark in §6a (`--shortlist config/models.json`), and the results are compared with `scripts/compare.ts`.
- T analyses in pandas and drives prompt/rules changes. The loop: change the rules text → re-run → compare. Tuning is done on a 45-dialogue split, and **20 dialogues are held out** (stratified by language + edge cases) to catch overfitting. Prompts stay generic: no dialogue IDs and no per-case hacks (process correctness).

## 8. UI screens ↔ 5-minute demo
| Demo minute | Screen | What we show |
|---|---|---|
| 0–1 | **Dialogues list** (`/`): group_id fetch box, filters, status, total, gross flag, confidence badge; batch "Evaluate all" + dashboard strip (avg score, pass rate per criterion, gross alerts) | Load the control group, pick a dialogue |
| 1–3 | **Dialogue card** (`/dialogue?id=`): left = transcript (bot/system greyed, internal turns tagged, hold bands, gap>3m markers); right = result table (criterion, answer, points/weight, explanation, evidence chips). Clicking a chip scrolls to and highlights the turn; for calls it also seeks the audio player. A missing action shows its checked span highlighted. N/A shows its reason. Section subtotals and total, gross banner | Evidence jump, an N/A example, total |
| 3–4 | **Appeal** (button per criterion → modal: comment) → **Reviewer queue** (`/appeals`): disputed answer, comment, transcript fragment around the evidence; uphold / change + reason → card shows original / decision / final and the new total | The appeal round trip |
| 4–5 | **Checklist editor** (`/checklists`): list, edit criterion (title, conditions, type, N/A toggle + condition, steps editor, weight, section, flag), rules block, live weight sum, save as new version + activate → re-run a dialogue | Replace a criterion live and re-run |
| Q&A / backup | **Сравнение моделей** (`/models`): measured agreement, KZ agreement, MAE, gross-error recall, cost per dialogue and latency for every shortlisted model, including the local one; the chosen default is marked | "Why this model, what does it cost" |

UI stack: Tailwind + a few shadcn/ui primitives, RU interface labels with a light EN toggle if cheap. There is no SSR data and no server actions.

## 9. Path to a Dynamics 365 web resource
- UI pages are client components using only `fetch(NEXT_PUBLIC_API_BASE + …)`. There are no dynamic route segments, no `next/image` optimisation, no middleware and no server actions, so `output: 'export'` with `images.unoptimized`, `trailingSlash` and a relative `assetPrefix` produces a static `out/` bundle.
- The API lives in `src/server/*` as plain functions. Today they are wrapped by Route Handlers. Later the same functions go into a small standalone Node service (Hono) deployed separately, with CORS allowing the D365 org. The bundle is uploaded as HTML/JS/CSS web resources, and `NEXT_PUBLIC_API_BASE` points to the service.
- A `npm run build:static` script proves the export builds (verified once before freeze). The README describes this path.

## 10. Timeline (UTC+5)
| Time | Z (+ Claude Code) | T |
|---|---|---|
| Sat 14:00–15:00 | Scaffold Next.js, core types, default checklist JSON, `fetch-dataset`, `export-readable`, SQLite | Set up keys/.env; read PDFs; start blind labelling from readable files |
| 15:00–18:00 | `facts.ts`, `scoring.ts` + unit tests, `prompt.ts`, Anthropic provider, evaluator, harness script | Label RU chats (30) |
| 18:00–20:00 | First full DEV run; dialogue list + card with evidence jump | Finish RU calls + EN; Z labels KZ in parallel (~1 h) |
| 20:00–23:00 | Checklist editor (CRUD, versions, live re-run); appeals + reviewer + recalculation | First harness analysis → rules/prompt iteration #1–2 |
| 23:00–02:00 | Provider-neutral interface + model registry, live-test all four adapters, `bench` + `compare` scripts, `/models` page | Check model IDs/prices on vendor pricing pages → registry; tune-split bake-off of the full shortlist (N=1); rules iterations #3–5 driven by cross-vendor disagreements |
| 02:00–06:00 | Polish, error states, README, `build:static` check; **sleep in shifts** (Z 02–05, T 05–08) | Freeze the prompt version → final bake-off on the hold-out (+ N=3 of the top 2, + cross-vendor ensemble) |
| **06:00–08:00 FEATURE FREEZE at 08:00** | Bug fixes only; set the winning default + other-vendor fallback; README model/cost section from measured numbers; push | Commit `benchmarks/final.json`, comparison slide |
| 08:00–10:30 | Rehearse demo ×3, record backup video, pre-pick demo dialogues | Prepare the replace-criterion example, cost table |
| 11:00 | Fetch control group → batch run (≈10 dialogues × N=3, a few minutes) | Spot-check results, nothing hand-edited |
| 11:45 | **Final commit** (stop-code 12:00); export CSV of results | — |
| 13:00 | Pitch | — |

## 11. Risks and fallbacks
- **Rate limits / API outage at 11:00:** run concurrency is configurable with retry/backoff. The fallback is the benchmark runner-up from a different vendor, so one vendor's outage can't stop the run. The keys are tested at 10:30.
- **Biased or noisy model choice:** same prompt for every candidate, cross-vendor-driven tuning, a frozen prompt before the final hold-out bake-off, and ties declared inside the bootstrap interval. The comparison table is shown, not just the winner.
- **An adapter fails on real data (schema rejected, truncated JSON):** every adapter is live-tested on 3 DEV dialogues before the bake-off. The invalid-output rate is a gate metric.
- **Local model too slow or too weak on KZ:** it stays in the table as an architecture proof (offline option), not as the default.
- **Model drift between runs:** majority voting with low-confidence flags. Final checklist and prompt are frozen at 08:00.
- **Overfitting to DEV:** hold-out split, generic rules only.
- **better-sqlite3 build issue:** fall back to `node:sqlite`, then to a JSON file store.
- **Audio host blocks the proxy:** fall back to opening the organiser's player page in a new tab (still meets "переход к плееру").
- **Live criterion-replace fails:** the editor is tested daily with a scripted replacement (e.g. a new "Proactive information" Yes/No/N/A criterion with weight 10). The prompt and schema are generated from data.
- **Static export blocked by some API use:** caught by `build:static` before the freeze.
- **Venue Wi-Fi:** phone hotspot, plus the backup video.

## 12. Verification
- `npm test`: scoring/facts unit tests (redistribution, all-N/A, scale proportion, rounding, new criterion).
- `npm run harness -- --samples 3`: agreement report against 65 labels. Targets are ≥85% per-criterion exact match and total MAE ≤ 8 on the hold-out.
- `npm run bench`: every registry model produces valid output on the smoke set. `benchmarks/final.json` exists, and the configured default matches its decision rule.
- Manual end-to-end in the browser: fetch DEV → evaluate one RU, one KZ, one EN and one call → evidence jump and audio seek → appeal → review → total recalculates → edit/replace a criterion → re-run shows the new criterion.
- `npm run build:static` succeeds. A fresh clone plus the README steps runs on the Windows machine too.
