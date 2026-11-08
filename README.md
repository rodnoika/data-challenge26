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
2. Pick the checklist under **Чек-лист для оценки**, then click **Оценить** on a dialogue or **Оценить все** for a batch run with progress. The dashboard counts only results from the selected checklist version and offers to re-evaluate the rest.
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
| `npm run results -- --set dev\|prod ...` | Build and check the results file for the organisers (see below) |
| `npm run rehearsal:checklists` | Write test checklists with one replaced criterion to `tmp/rehearsal/` |
| `npm run impact -- --base <before>.json --run <after>.json [--noise <x3>.json]` | What a checklist change did to the other criteria, next to run-to-run noise |
| `npx tsx scripts/make-v3-checklists.ts` | Write three whole new checklists for the robustness check (see [Checks beyond DEV](#checks-beyond-dev)) |
| `npm run build:static` | Static UI bundle in `out/` (Dynamics 365 web-resource path) |

## Model and cost

- **Evaluation model: chosen by benchmark, not by default.** The same prompt runs through Anthropic, OpenAI, Google Gemini and a local Ollama model. The model with the highest agreement with our hand labels, within budget, becomes the default. Method: [PLAN.md](PLAN.md) §6a. Results: the **Сравнение моделей** page.
- **Current default: `openai/gpt-6.1-terra`, one vote, reasoning `medium`, about $0.005 per evaluation (measured; prices checked 2026-11-07).** On prompt `p7` and 42 labelled train chats it matched 96.1% of the answers (95% CI 93.5–98.5%, mean κ 0.86), found all 6 gross errors and raised no false flag. Humans labelled 26 of those chats (97.1% match) and `claude-opus-5-5` labelled 16 (94.5%). We wrote the c04 rules added in `p5` and `p6` from these same chats, so the train figure runs high. `gpt-6-luna` ×3 cost $0.0022 and raised one false gross-error flag, but we last measured it on `p4` (93.8%), so its figure does not compare with `p7`. We compared only OpenAI models. On the 18 held-out test chats, run once on `p7`, it matched 94.4% of the answers (136/144, 95% CI 91.7–97.2%, mean κ 0.88), found both gross errors and raised no false flag; `claude-opus-5-5` labelled 7 of those chats. The table below is the earlier comparison on prompt `p2`, before the labels existed.

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
  | Local (Ollama) | `qwen3.5:9b-q4_K_M` | ISSAI `Qwen3.5-9B-Kazakh` Q4_K_M | `qwen3:14b` |

- **Local models:** the two 9B models are an A/B with the same quantisation. ISSAI's version adds Kazakh continued pretraining, which raises its Kazakh benchmark scores but lowers its reasoning scores. Both fit an M4 with 24 GB. Larger Qwen 3.6/3.8 (27B+) do not fit with room for the context. To run them:

  ```bash
  ollama pull qwen3.5:9b-q4_K_M
  ollama pull hf.co/mradermacher/Qwen3.5-9B-Kazakh-GGUF:Q4_K_M
  npm run bench -- --split train --tiers local --concurrency 1
  OLLAMA_THINK=false npm run bench -- --split train --tiers local --concurrency 1   # same, without the reasoning pass
  ```

  Use `--concurrency 1`, because parallel requests each reserve their own context memory. `OLLAMA_NUM_CTX` sets the context size (default 16384).

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
2. **The prompt is built only from the stored checklist.** That means the criteria, scale steps, N/A conditions, a hint per criterion, and an editable *rules* block for what holds across criteria. A rule about one criterion lives in its hint, so it leaves the prompt when you replace that criterion. The model returns, per criterion: answer, short explanation, evidence turn ids, checked span and N/A reason. A JSON schema generated from the checklist enforces this.
3. **Points are never computed by the model.** `scoring.ts` follows the PDF calculation order:
   - Yes = full weight, No = 0
   - scale steps convert proportionally, so the top step gives the full weight
   - N/A is excluded and its weight is redistributed so the maximum stays 100
   - the total is rounded to 2 decimals, and there is no total if nothing applies
   - gross errors are flagged separately and do not change points
4. **Self-consistency:** N independent votes (whether N>1 helps is measured in the benchmark). Yes/No/N/A uses the majority and scales use the median. Any disagreement marks the criterion as *needs review* in the UI.

Every evaluation stores the exact checklist version, prompt version, model, votes, tokens, cost, the prompt it sent and the raw model response with the vendor's response id. **Журнал оценки** in the dialogue card shows them. Nothing is pre-computed or replayed: each click runs the model on the dialogue with the current active checklist. The CSV and JSON exports name the checklist version on every row.

## Submitting results

The organisers collect `results/dev/results.json` (DEV: 60 chats and 5 calls) and `results/prod/results.json` (10 control chats) from the public repository, in format 1.0.

```bash
npm run results -- --set dev --data data/dev.json --team "<team>"
npm run results -- --set prod --group <group_id> --team "<team>"   # or --data <file.json>
npm run results -- --set prod --validate                           # check the file again, no model calls
```

**Control hour, in this order.** The control set arrives 23 hours after the start and both files must be pushed by the stop-code an hour later.

1. Get the set the way the organisers say, keeping their `conversation_id`s.
2. Run `npm run results -- --set prod ...` and wait for "Format check passed". The command always uses the default checklist, whatever is active in the UI.
3. Commit and **push** `results/prod/results.json` at once. A local file or an unpushed commit does not count.
4. Only then replace a criterion in the UI for the demo. A replaced checklist cannot be written in this format, and a re-run after the change would stop with an error.
5. If the organisers change the checklist itself for scoring, ask them how the file should look before re-running.

- The command evaluates every dialogue, retries failures once and writes a failed dialogue as `status: "error"`, never as a zero.
- It then checks every rule of the format: record count, ids against the source, the 8 criteria, allowed values, and the score recomputed from the values.
- The format counts turns from 1 over the whole transcript, and so does the dialogue card. Inside the evaluator and in the raw model response they count from 0.
- The file covers the 8 criteria of the default checklist. Its codes are fixed, so a checklist with a replaced criterion stops with an error instead of writing a wrong file.

## Accuracy harness (hand labels)

The organisers compare the answer on each criterion on a control set of chats, so `harness` and `bench` measure exact per-criterion match on chats. Add `--with-calls` to include calls.

1. Run `npm run export:readable -- data/dev.json`. This writes `data/readable/<id>.md` (numbered transcript plus facts) and `data/labels/dev-labels.csv`.
2. Fill the CSV blind, without looking at model output. Use `yes/no/na` for Yes/No criteria and the step value (`0/5/10/15/20`, `0/4/7/10`) or `na` for scales.
3. Run `npm run harness -- --model <provider>/<model> --split train`. It reports:
   - per-criterion exact agreement and the confusion pairs
   - with `--disputed data/labels/disputed.csv`, the same numbers without label cells that careful labellers dispute. Three blind labellers relabelled all 60 chats from the checklist alone, without our labels or model output: two Claude agents, which then defended or changed their answers where they differed, and Codex as a third, other-vendor opinion. The file lists the 19 cells where the majority of the three does not back our label. The selection does not depend on the evaluated model's answers. All three labellers are models, so a person should settle these cells
   - Cohen's κ per criterion and its mean: agreement corrected for chance. Exact agreement looks high on criteria where one answer dominates, κ does not. Scales also get quadratic-weighted κ, where a miss by two steps costs more than a miss by one
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

## Checks beyond DEV

We wrote the prompt rules from DEV chats, so DEV figures run high. To see how the evaluator behaves on input it never saw, we ran four more checks with the same model and prompt (`openai/gpt-6.1-terra`, one vote, reasoning `medium`, prompt `p7`). We changed no code and no prompt text for any of them.

| Check | Data | Labels by | Result |
|---|---|---|---|
| Reference: DEV held-out chats | 18 chats | people; `claude-opus-5-5` labelled 7 of the chats | **94.4%** (136/144), gross errors 2/2 |
| `traps-v1`: new dialogues with traps | 30 invented dialogues (26 chats, 4 calls) | Codex | **97.1%** (233/240), 98.3% without 9 disputed cells, gross errors 4/4 |
| `traps-v2`: clean, minor-error and trap dialogues | 30 invented dialogues (27 chats, 3 calls) | Claude | **97.5%** (234/240), 98.3% without 11 disputed cells, target of each dialogue hit 29/30, gross errors 2/2 |
| One criterion replaced, as at the control | 42 DEV train chats, 4 checklists | people and Opus (DEV labels); Claude for the new criteria | answers on untouched criteria changed in **2.0–3.4%** of cases (two runs of the unchanged checklist differ in 2.4%); new criteria **97.6%** (41/42) |
| Whole new checklists (`traps-v3`) | 3 checklists × 10 invented dialogues | Claude | **95.0%** (171/180), gross errors 6/6 |

No run produced a false gross-error flag, a failed evaluation or invalid output.

**How to read these figures.** The invented sets are easier than DEV: answering the most common value for every criterion scores 78.1% on the DEV held-out dialogues but 86.7% on `traps-v1` and 88.8% on `traps-v2`. Measured against that baseline, the evaluator removes 74% of the remaining errors on DEV and 78% on both trap sets, so it does about as well on new dialogues as on DEV, not better. Models wrote and labelled the invented sets from the same checklist text that builds the prompt. These sets show that the evaluator follows the checklist rules. They do not measure agreement with the organisers' experts: the DEV held-out figure stays our estimate for the control set.

**What the checks found.**

- **Traps by rule pass.** The evaluator handles a call recording that starts after the greeting (c01 N/A), a greeting in the operator's second message in a row, details given to the bot (c02 N/A), a client who refuses identification (c03 N/A), a client who leaves before asking anything, a rude client, a paid service of the company itself, account data disclosed before verification, and an offer to move money to the operator's own card.
- **New definitions win over old habits.** With the new checklists the evaluator follows the new wording: "Пожалуйста. Хорошего дня!" counts as a goodbye where the criterion asks only for a goodbye, and the gross-error flag follows each checklist's own list of violations. Scales of 0–3 and 1–5 and a criterion computed from timestamps (first reply within 2 minutes) work without code changes.
- **Replacing one criterion leaves the rest stable.** The one shift above noise: when empathy (c05) was replaced, closing (c07) changed in 5 of 42 chats against 1–2 in noise. Without our extra c04 rules, c04 drops from 39 to 36 of 42 train chats. We wrote those rules from the train chats, so we checked the held-out chats too: c04 drops from 16 and 15 of 18 (two runs with the rules) to 14 of 18, and the total from 94.4% to 93.1%. The rules help on chats they were not written from about as much as on the ones they were.
- **The replaced criteria themselves score as well as the original ones.** Claude labelled the three new criteria from `npm run rehearsal:checklists` blind, from their wording only, on 14 DEV chats (`data/labels/rehearsal-new-criteria-labels.csv`). Each criterion has two saved runs: ours and an earlier one by the team. Both runs give the same result: proactivity 14/14, clarity of instructions 13/14, feedback deadline 14/14, so **41/42 (97.6%)** per run. The one miss is a cell marked disputed in advance (`p1-kz-009`, step 5 against 10). Without the 8 disputed cells both runs score 34/34.

Reports: [traps-v1](data/synthetic/traps-v1-report.md), [traps-v2](data/synthetic/traps-v2-report.md), [traps-v3](data/synthetic/traps-v3-report.md), [one criterion replaced](benchmarks/checklist-robustness-2026-11-08.md). Dialogue descriptions sit next to each set in `data/synthetic/`, labels in `data/labels/traps-*`.

Reproduce (about $0.15 per set):

```bash
npm run harness -- --data data/synthetic/traps-v2.json --labels data/labels/traps-v2-labels.csv --split all --with-calls true
npm run harness -- --data data/synthetic/traps-v2.json --labels data/labels/traps-v2-labels.csv --split all --with-calls true --disputed data/labels/traps-v2-disputed.csv
npx tsx scripts/make-v3-checklists.ts   # writes data/synthetic/checklists/v3-*.json
npm run harness -- --data data/synthetic/traps-v3-cx.json --labels data/labels/traps-v3-cx-labels.csv --checklist data/synthetic/checklists/v3-cx.json --split all --with-calls true
```

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

The full list is in [PLAN.md](PLAN.md) §2. The interpretations also live in the checklist, in the criterion hints and the *rules* block, and you can view the generated prompt in the editor. The main ones:

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
