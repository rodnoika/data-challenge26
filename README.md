# CQA — Conversation Quality Analytics (Freedom Broker × NU Data Challenge)

A prototype that scores operator work in client chats and calls (RU / KZ / EN) against a configurable checklist. It shows the evidence for every score and supports appeals and reviewer decisions.

- **Contour 1:** checklist editor → load dialogues → automatic evaluation → result. Every criterion shows the answer, points, weight, explanation, evidence turns, the checked span and the N/A reason. Section subtotals and the total are shown, and gross errors are flagged.
- **Contour 2:** dialogue card with evidence links (jump to the message or seek the call recording) → appeal → reviewer decision → recalculated total. The card shows the original score, the decision and the final score.

## Quick start

Requires **Node.js 20+** (tested on Node 26, macOS Apple Silicon; Windows works the same).

```bash
npm install
cp .env.example .env.local      # then fill in .env.local (see below)
npm run fetch:dataset -- DEV    # optional: saves data/dev.json for tests / harness
npm run dev                     # http://localhost:3000
```

In `.env.local` set:
- `ANTHROPIC_API_KEY`, or the key of whichever provider you choose
- `ORGANISER_API_URL`: the DEV GET link from the task PDF (page 3), pasted as is

Signed links (the dataset URL, recording links) are deliberately kept out of git. `data/*.json` and `data/readable/` are ignored and regenerate with the commands below.

On Windows use `copy .env.example .env.local`.

In the UI:

1. **Диалоги:** type a `group_id` (e.g. `DEV`) and click **Загрузить**. The backend calls the organisers' API, so there is no CORS. You can also upload a JSON file in the same format.
2. Click **Оценить** on a dialogue, or **Оценить все** for a batch run with progress.
3. Open a dialogue to see the result card. Evidence chips `#12` scroll to and highlight the turn. For calls they also seek the recording. Click **Оспорить** to file an appeal.
4. **Апелляции:** the reviewer upholds or changes the score with a reason, and the total is recalculated.
5. **Чек-листы:** edit, add or replace criteria (wording, weight, answer type, N/A and its condition, scale steps, section). Save a new version and re-evaluate. The prompt and the output schema are generated from the checklist, so no code changes are needed.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Unit tests (scoring, N/A redistribution, facts, aggregation) |
| `npm run fetch:dataset -- DEV` | Save the raw organiser payload to `data/dev.json` |
| `npm run export:readable -- data/dev.json` | Readable transcripts + label template for hand-labelling |
| `npm run harness -- --model <provider>/<model>` | Accuracy of one model against hand labels (prompt/rules iteration) |
| `npm run bench -- --smoke` | Live-test every adapter on 3 dialogues (no labels needed) |
| `npm run bench -- --split train` | Model benchmark: same prompt on the whole shortlist (see below) |
| `npm run compare -- benchmarks/<file>.json [--apply]` | Comparison table + decision rule; `--apply` sets the default model |
| `npm run build:static` | Static UI bundle in `out/` (Dynamics 365 web-resource path) |

## Model and cost

- **Evaluation model: chosen by benchmark, not by default.** The same prompt runs through Anthropic, OpenAI, Google Gemini and a local Ollama model. The model with the highest agreement with our hand labels, within budget, becomes the default. Method: [PLAN.md](PLAN.md) §6a. Results: the **Сравнение моделей** page.
- **Current default: `openai/gpt-6.1-terra`, one vote, reasoning `medium`, about $0.005 per evaluation (measured; prices checked 2026-11-07).** On prompt `p4` and 26 hand-labelled train chats it matched 95–96% of the answers. `gpt-6-luna` ×3 matched 97–98% at $0.0022, within the margin of error on this sample. We kept `terra` because it answered all 31 known answers correctly and raised no false gross-error flag, while `gpt-6-luna` ×3 raised one. Only OpenAI models were compared, and the test set has not been run. The table below is the earlier comparison on prompt `p2`, before the labels existed.

  | Candidate | Known answers | Same answer in two runs | Total-score drift between runs (mean / max) | $ per evaluation |
  |---|---|---|---|---|
  | `gpt-6-luna` ×1 | 96.7% | 88.8% | 6.7 / 41 | 0.0009 |
  | `gpt-6-luna` ×3 | 98.9% | 93.1% | 3.2 / 24 | 0.0025 |
  | `gpt-5-nano` ×1 | 83.3% | 88.1% | 7.7 / 38 | 0.0026 |
  | `gpt-6.1-terra` ×1, reasoning `low` | 100% | 95.0% | 3.9 / 30 | 0.0040 |
  | `gpt-6.1-terra` ×1 | 100% | 98.8% | 0.9 / 10 | 0.0056 |
  | `gpt-5.4-mini` ×1 | 96.7% | 88.8% | 6.1 / 29 | 0.0086 |
  | `gpt-6.1-sol` ×3 (reference) | 100% | one run only | not measured | 0.0318 |

- **Model registry:** [config/models.json](config/models.json) lists each candidate with its tier, its prices and the pricing-page URL and date they were checked. Current shortlist, checked 2026-11-07:

  | Vendor | Frontier | Cheap | Optional mid |
  |---|---|---|---|
  | Anthropic | `claude-opus-5-5` | `claude-haiku-5-5` | `claude-sonnet-5-5` |
  | OpenAI | `gpt-6.1-sol` | `gpt-6-luna` | `gpt-6.1-terra` |
  | Google | `gemini-4-argon` | `gemini-3.5-flash-lite` | `gemini-3.8-flash` |
  | Local | `qwen3:14b` via Ollama | | |

- GPT-5 candidates (`gpt-5-nano`, `gpt-5-mini`, `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.6-luna`) are optional registry entries: add `--with-optional` to include them in a benchmark.
- If the registry has no default, the app uses the first cheap model whose vendor has a key, and the UI labels it as a placeholder.
- Provider, model, vote count and reasoning depth are switchable in the UI (⚙ on the Dialogues page). Every stored result records which provider and model produced it.
- **Cost per evaluation (all calls and votes included):** every evaluation stores its real token usage. Cost is tokens × the prices in the model registry and is shown in the card and as the average on the dashboard.

## How the evaluation works

```
transcript ──► facts.ts (deterministic) ──► prompt.ts (generated from checklist JSON) ──► LLM × N votes
                                                                                    │
                     scoring.ts (points, N/A redistribution, sections, rounding) ◄──┘ validated JSON judgments
```

1. **Facts are computed in code, not by the model.** They cover:
   - first operator reply, client language, escalation
   - possible wait warnings. Reply times are shown in the card only: the checklist excludes the 3-minute threshold from scoring, so they stay out of the prompt
   - hold / internal consultation windows (those operator turns are marked INTERNAL)
   - system identity-verification event, how the conversation ended, duplicates in call transcripts
   - audio offsets per turn (recording pauses excluded)
2. **The prompt is built only from the stored checklist.** That means the criteria, scale steps, N/A conditions, and an editable *rules* block (checklist FAQ plus documented interpretations). The model returns, per criterion: answer, short explanation, evidence turn ids, checked span and N/A reason. A JSON schema generated from the checklist enforces this.
3. **Points are never computed by the model.** `scoring.ts` follows the PDF calculation order:
   - Yes = full weight, No = 0
   - scale steps convert proportionally, so the top step gives the full weight
   - N/A is excluded and its weight is redistributed so the maximum stays 100
   - the total is rounded to 2 decimals, and there is no total if nothing applies
   - gross errors are flagged separately and do not change points
4. **Self-consistency:** N independent votes (whether N>1 helps is measured in the benchmark). Yes/No/N/A uses the majority and scales use the median. Any disagreement marks the criterion as *needs review* in the UI.

Every evaluation stores the exact checklist version, model, votes, tokens and cost. Nothing is pre-computed or replayed: each click runs the model on the dialogue with the current active checklist.

## Accuracy harness (hand labels)

The organisers compare the answer on each criterion on a control set of chats, so `harness` and `bench` measure exact per-criterion match on chats. Add `--with-calls` to include calls.

1. Run `npm run export:readable -- data/dev.json`. This writes `data/readable/<id>.md` (numbered transcript plus facts) and `data/labels/dev-labels.csv`.
2. Fill the CSV blind, without looking at model output. Use `yes/no/na` for Yes/No criteria and the step value (`0/5/10/15/20`, `0/4/7/10`) or `na` for scales.
3. Run `npm run harness -- --model <provider>/<model> --split train`. It reports:
   - per-criterion exact agreement and the confusion pairs
   - ±1-step agreement for scales
   - total-score MAE
   - per-language agreement
   - gross-error TP/FP/FN, cost and latency
   
   Results go to `runs/*.json` and `runs/*.csv`, ready for pandas.
4. `--split test` evaluates the 20 dialogues listed in `data/splits/dev-test-ids.txt`. The other 45 are train. Change rules from train errors only. Use test to compare final candidates, and read only its aggregates: the per-dialogue CSV omits test rows unless you pass `--show-test`. `--from runs/x.json` re-scores a previous run after label fixes without calling the API.

### Model benchmark

```bash
npm run bench -- --smoke                    # every adapter answers valid JSON on 3 dialogues
npm run bench -- --split train              # shortlist: frontier + cheap per vendor + local
npm run bench -- --split test --with-optional \
  --n3 "<best two>" --ensemble "<one model per vendor>"
npm run compare -- benchmarks/<file>.json --apply
```

- **Same input for every candidate:** prompt version, checklist version and reasoning level are identical. Each vendor enforces the same JSON schema through its own structured-output mechanism, and validation plus the single re-ask run in shared code.
- **Budget check:** the projected cost is printed before any call, and the bench asks for confirmation above $5.
- **Gates:** every labelled gross error must be caught, and invalid output and failures must each stay under 5%. Cost must be within the cap.
- **Choice:** the highest agreement wins. Candidates inside the leader's 95% bootstrap interval count as tied, and ties go to the cheaper, then faster model.
- **Fallback:** the runner-up from a different vendor.
- **Output:** summaries in `benchmarks/` (metrics only), shown on the **Модели** page.

## Architecture

- **Next.js (App Router, TypeScript)** as one project.
  - UI pages are client components (`app/*/page.tsx`) that only call `fetch(NEXT_PUBLIC_API_BASE + /api/...)`.
  - The API is Route Handlers (`app/api/**`), which are thin adapters over `src/server/*`.
- **Storage:** SQLite (`data/cqa.db`, via better-sqlite3), holding dialogues, checklist versions, evaluations, appeals, reviews and batch jobs.
- **`src/core/*`** is framework-free and unit-tested (types, facts, scoring, prompt, aggregation). It is shared by the server, the UI and the scripts.

### Path to a Dynamics 365 HTML web resource

The UI uses no server components with data, no server actions, no middleware, no `next/image` optimisation and no dynamic page segments. The dialogue card uses `?id=` instead of a dynamic segment. As a result, `npm run build:static` produces a plain HTML/CSS/JS bundle in `out/` (verified).

To deploy:

1. Host `src/server` as a small standalone Node API, with the same functions behind any HTTP framework and CORS allowing the D365 org.
2. Set `NEXT_PUBLIC_API_BASE` to that API.
3. Upload the `out/` files as web resources.

## Interpretations of the checklist

The full list is in [PLAN.md](PLAN.md) §2. The interpretations also live in the editable *rules* block of the checklist, and the generated prompt can be viewed in the editor. The main ones:

- Bot and system turns are context only.
- The bot greeting does not count as the operator's.
- A redacted name counts as an introduction.
- A general question needs no identification (N/A). Account data shown without confirmation is "No".
- Closing a chat without saying goodbye is "No". The client leaving or the connection dropping is N/A.
- A wait without a warning is one "noticeable failure" in 06.
- ASR noise in calls is not held against the operator.
- Gross errors do not zero the score.

## Team

Two people: Z (full-stack, UI and engine, Kazakh labels) and T (labelling, accuracy harness, prompt/rules tuning).
