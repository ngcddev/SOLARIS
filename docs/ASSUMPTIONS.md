# Assumptions and `VERIFY` items

## Design decisions
- Next.js App Router + CSS Modules / CSS variables (`src/styles/tokens.css`); no Tailwind, so the future design system is not coupled to a utility framework.
- The dashboard refreshes by polling (2 s); SSE is a possible improvement.
- If the command center keys are not in the environment, the server generates an ephemeral in-memory pair (fine for demos; packets do not survive a restart).
- Data access sits behind an interface; in-memory implementation by default, Supabase/Postgres as the target.
- The demo scenario is **Cali, 2026 (fictional earthquake)**, by the author's decision; it replaces the Popayán 1983 scenario of the original brief.
- Benchmark: manual review is estimated at 2 minutes per SOS (assumption).
- Codec2 is not implemented: only the theoretical size (~1,200 bps) is displayed.
- The citizen simulator's audio travels **without Codec2**: mono PCM16 WAV at 16 kHz, fragmented into signed and encrypted packets of up to ~60 kB (on the real mesh it would be ~200-byte Codec2 fragments). The UI shows the theoretical Codec2 size.
- The scenario audio uses the `SIMULATED_AUDIO:<text>` fixture, which only the transcription mock understands; in rules mode there is no transcription (triage continues with the buttons and waiting time).
- Audio actually recorded in the browser cannot be transcribed in simulated mode (it returns an empty string); it needs `META_API_KEY`.
- Replay window 600 s, deduplication window 120 s, limit of 5 SOS per identity every 10 min: configurable defaults (`.env`).
- The same message arriving through another path **inside** the deduplication window is merged; the same path, or arrival outside the window, is treated as a replay.
- Audio messages do not consume the per-identity quota, and only fragments from the sender that started an audio are accepted.
- Mesh: Bluetooth ~50 m (configurable), LoRa trunk ~2.5 km, gateways are sinks, default TTL 8 (10–12 in simulations). Scenario nodes and phones are generated from a fixed seed.
- Node proximity: the **first relay** is compared against the reported location; with no node data the signal is neutral (0.5).
- Confidence weights: signature 0.15, seismic event 0.25, corroboration 0.20, proximity 0.15, coherence 0.25; a field photo with people adds up to +10. With no registered seismic event the signal is 0.4.
- The demo's seismic event is **fictional** (M6.1, Cali, 2026) and the UI marks it as simulated. The real USGS feed is behind `USGS_FEED_ENABLED=true`.
- The map uses plain Leaflet with no clustering/heat plugins: the **density** view is translucent circles per case. OpenStreetMap tiles are shown in grayscale through a CSS filter.
- Field photos are kept in memory as data URLs (max ~6 MB); in production they would go to a private bucket.
- A synthetic "sample image" lets the photo flow be demoed without a real picture; it is labelled as such.
- State is in memory: restarting the server wipes everything (the Postgres schema is in `supabase/schema.sql`, not implemented).
- The packet header's `urgency` is an unauthenticated hint; the real priority comes from triage.
- Language: code, docs and UI are in English. Citizen messages in the demo scenario stay in Spanish on purpose (they model SOS from Cali), the rules engine understands Spanish and English keywords, and the transcription language hint is `es`.

- Multimodal cross-check: the photos are sent to Muse Wonder as image parts next to the structured report. In simulated mode the same rules (`src/lib/ai/reports.ts`) produce the verdict, so demos are deterministic. The verdict adds +8 (consistent) or -15 (contradictory) to confidence and never discards a case; "insufficient" changes nothing.
- Shift handover: Wonder receives a number-only JSON snapshot and must use only numbers present in it; output is validated and screened for medical language. The simulated/fallback version is a deterministic template.
- Level 2 (local Llama) only covers triage. Transcription, vision and the analyst tasks use rules when the internet is down. It is enabled only if `LOCAL_LLM_URL` is set (Ollama-compatible `/api/chat`, default model `llama3.2:3b`); there is no automatic reachability switch: if the server is down, triage falls back to rules and the dashboard shows a notice.
- Impact numbers in the dashboard are computed from live state. "Manual review avoided" uses the same assumed 2 minutes per SOS as the benchmark.
- The evaluation dataset labels are written by us from documented rules. The rules engine was calibrated against this same dataset, so its numbers are optimistic; the Meta and local rows are the ones to trust (see `docs/EVALUATION.md`).
- The app uses the Supabase repository only when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set; some state is still process-local (see `docs/DEPLOYMENT.md`).

## Findings from https://dev.meta.ai/docs (checked on 2026-10-27)
Confirmed in the public documentation:
- Base URL `https://api.meta.ai/v1`, `Authorization: Bearer <key>`; the environment variable in the docs is `MODEL_API_KEY` (both `META_API_KEY` and `MODEL_API_KEY` are accepted here).
- Current IDs: `muse-spark-1.3` (also 1.2, 1.1), `muse-wonder-1.0` (preview), `muse-voice-transcribe-1.0`, `sam-3.1`.
- File transcription: `POST /v1/asr/transcribe` (returns text with turn-level timestamps, no word-level timestamps).
- SAM 3.1: `POST /v1/responses` and `POST /v1/files`; returns boxes and masks.

## VERIFY (Meta API)
Items that still need confirming with real API access (credits pending). Each one is marked `// VERIFY:` in the code:
1. `src/lib/ai/meta.ts`: shape of `response_format` (JSON schema) in Chat Completions, and the `/chat/completions` path.
2. `src/lib/ai/meta.ts`: multipart fields, keyword biasing and language hint of `POST /asr/transcribe`; response shape (`text` or `turns[]`).
3. `src/lib/ai/meta.ts`: SAM 3.1 request through `/responses` with `input_image`, one phrase per call, and mask format (normalized polygons or boxes).
4. `src/lib/ai/config.ts`: current Spark ID (`muse-spark-1.3` per the docs) and that `muse-wonder-1.0` stays available outside preview.
5. `src/lib/geo/geo.ts`: USGS feed URL.
6. Real rate limits, per-call cost and latency of Spark/Wonder (the benchmark in `meta` mode includes network latency).
7. `src/lib/ai/meta.ts`: multimodal message format for Muse Wonder (OpenAI-style `image_url` parts assumed) and image size limits, used by the cross-check.
8. `src/lib/ai/local.ts`: Ollama structured outputs (`format` as a JSON schema) on the Ollama version installed.
9. Whether Wonder's 1M-token context lets us send the full case history to the handover report instead of a number-only snapshot (the snapshot is the safe default).

## AI behavior
- Without `META_API_KEY` => simulated mode (deterministic mock derived from the content). With "Simulate internet outage" => level 3 (rules), no external calls.
- Every model output is validated with Zod; if it fails, or contains medical language (list in `src/lib/ai/safety.ts`), level 3 or a safe template is used.
- The analyst (Wonder) is only called on demand; suggestions with unknown ids, busy teams or double bookings are dropped.
- Confidence: the low-confidence threshold is 45/100; it only lowers priority by one level and flags human review.
