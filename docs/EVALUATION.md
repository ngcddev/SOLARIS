# Triage evaluation

Solaris ranks help requests (P1 critical … P4 low). This document describes how we measure how good that ranking is, at every AI level, and what the numbers do and do not prove.

## What is measured

| Metric | Meaning | Why it matters |
|---|---|---|
| **Exact accuracy** | Predicted priority equals the human label. | Overall agreement. |
| **P1 recall** | Of the truly critical cases, how many were ranked P1. | The key safety metric: a critical case that is not ranked first is the costly mistake. |
| **Severe under-triage** | Critical (P1) cases ranked two or more levels too low (P3/P4). | A hard "never" in a real deployment. Target: 0. |
| **Within-one accuracy** | Predicted priority is at most one level away from the label. | Tolerance for borderline cases. |
| **Per-priority precision / recall / F1** and the **confusion matrix** | Where the errors are. | Over-prioritizing costs rescuer time; under-prioritizing costs lives. |
| **Safety rate** | Share of generated justifications with no medical-advice language (`containsMedicalAdvice`). | Solaris must never sound like medical advice. Target: 100 %. |
| **Joke / contradiction recall** | Share of joke or contradictory reports whose `coherence` is below 0.4 (and the false-positive rate on normal reports). | Feeds the confidence score; low coherence never discards a case. |
| **Average latency** | Mean `latencyMs` per triage call. | Matters for Spark; near zero for rules/mock. |
| **Degraded** | Calls where the requested level failed and the system fell back to rules. | A Meta run with degraded > 0 mixes levels; read its numbers with care. |

## Dataset

`eval/dataset.ts` holds 63 cases that we labeled by hand. Each case has the same inputs triage receives (button data, people count, minutes waiting, optional transcript), the expected priority, tags, and an optional `expectedLowCoherence` flag.

- Categories: **A** entrapment, **B** fire, **C** bleeding, **D** injury or stranded person, **E** damage only / people safe, **F** jokes and contradictory reports.
- Languages: mostly Spanish transcripts (they model SOS from Cali, Colombia), plus English ones.
- Tags mark the feature under test: `vulnerable`, `group`, `long-wait`, `combo`, `de-escalation`, `button-text-mismatch`, `buttons-only`, and so on.
- **The labels were written from the rubric below, not from any engine output.** If a label turns out to be wrong according to the rubric, fix the label; do not tune labels to an engine.

## Labeling rubric (ground truth)

1. **Classify the reported situation** and take its base priority:
   - **Entrapment** (trapped, crushed, under rubble or a collapsed structure): **P2**
   - **Fire**: **P2**
   - **Bleeding**: **P3**
   - **Injury** without bleeding, or a person stranded who cannot evacuate: **P3**
   - **Damage only / people safe / no injury**: **P4**
2. **Escalate one level** (towards P1, capped at P1) for **each** of:
   - a vulnerable person is present (baby, child or older adult): at most one escalation, however many vulnerable people there are;
   - a group of 4 or more people;
   - waiting 120 minutes or more;
   - two simultaneous hazards among entrapment, fire and bleeding.
3. **De-escalate one level** (floor P4) if the report explicitly says the situation is minor or stable (for example "small scratch", "already stable", "controlled fire", "nothing is happening").
4. **Jokes and contradictions** are labeled by the situation **as reported**. Credibility is the job of the confidence score, which only demotes and flags for review and never discards. Such cases carry `expectedLowCoherence: true` and are scored separately.
5. If the text contradicts the buttons, the text wins (for example button "Other" with text "I am trapped under the ceiling" is an entrapment).

Priorities are a coordination aid for rescuers, not a clinical judgement. The rubric uses no medical criteria beyond what the person reports.

## How to run

```bash
npm run eval          # rules + mock always; meta only with META_API_KEY; local only with LOCAL_LLM_URL
npm run test          # tests/eval.test.ts enforces the thresholds for the rules engine
```

`npm run eval` prints a table and writes `eval/results.json` (metrics, per-priority stats, confusion matrix and every miss).

CI-style thresholds enforced by `tests/eval.test.ts` for the level-3 rules engine: **exact accuracy ≥ 0.75**, **P1 recall ≥ 0.9**, **safety rate = 1**.

## Results

### Level 3 rules and deterministic mock (reproducible, no credentials)

Measured with `npm run eval` on the dataset above. See "Calibration history" for how the engine got there.

| Level | Exact accuracy | P1 recall | Within one | Severe under-triage | Safety | Joke recall |
|---|---|---|---|---|---|---|
| Rules (level 3) | 87.3 % (55/63) | 100 % (17/17) | 100 % | 0 % | 100 % | 80 % (4/5) |
| Mock (simulated) | 87.3 % (55/63) | 100 % (17/17) | 100 % | 0 % | 100 % | 80 % (4/5) |

Remaining rules misses (8): A13 (button "Other" with trapped text, ranked P3 instead of P2), A14 (injured under rubble, P1 instead of P2), B07 and C08 and D07 and F04 (explicitly minor or "nothing happened" reports ranked one level too high), D10 (injured child, P1 instead of P2), D13 (stranded older adult, P3 instead of P2). All are one level off; none under-ranks a critical case.

### Meta models (paste real results when credits are available)

Run `META_API_KEY=... npm run eval` and paste the `meta` row here. Run it again with `LOCAL_LLM_URL=...` for the local Llama level.

| Level | Model | Exact accuracy | P1 recall | Within one | Severe under-triage | Safety | Joke recall | Avg latency | Degraded |
|---|---|---|---|---|---|---|---|---|---|
| Level 1 | `muse-spark-1.3` | _pending API access_ | | | | | | | |
| Level 2 | local Llama | _pending_ | | | | | | | |

## Calibration history

The rules engine was written before this dataset existed. Its first evaluation (unmodified engine, same dataset) gave:

| Version | Exact accuracy | P1 recall | Within one | Severe under-triage |
|---|---|---|---|---|
| Before calibration | 73.0 % (46/63) | 58.8 % (10/17) | 98.4 % | 0 % |
| After calibration | 87.3 % (55/63) | 100 % (17/17) | 100 % | 0 % |

The misses were systematic: trapped or fire cases with a child, an older adult, or a group of 4+ people landed at P2 instead of P1, because vulnerability weights were too small (baby +2, child +1, older adult +1, group +1). Two changes in `src/lib/ai/rules.ts`, both justified by the rubric:

1. **Calibration (two constants):** any vulnerable person adds +2 (counted once, they do not stack) and a group of 4 or more adds +2 (was +1).
2. **Bug fix:** the child pattern `\bkid` matched "kidding", so "just kidding" marked a child as present; it is now `\bkids?\b`.

Any further change must be justified by the rubric, not by the score.

## Limitations (read before quoting a number)

- **The dataset is small (63 cases) and written by the team.** It checks consistency with our own rubric, not real-world correctness. Treat 1 case as about 1.5 points of accuracy.
- **Labels reflect one rubric.** Real rescuer protocols (Defensa Civil, Cruz Roja, USAR) differ; a pilot should replace this rubric with theirs and have several rescuers label independently (inter-annotator agreement is not measured here).
- **Rules were calibrated on the same dataset they are tested on.** The rules number is therefore optimistic. The Meta and local rows are the honest ones because those models were not tuned to this data.
- **Only the triage priority is measured**, not transcription quality, SAM masks, trust scores or assignment quality.
- **The mock is derived from the rules**, so its numbers are not independent evidence.
- **The transcripts are clean text.** Real audio goes through speech recognition first and will be noisier.
- A Meta run with `degraded > 0` partly measures the rules fallback.
