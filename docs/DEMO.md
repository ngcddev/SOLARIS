# Demo script and video storyboard

Target length: **3 minutes** live, **2:30** for the video. Everything below is reproducible with no credentials: without `META_API_KEY` the AI runs in deterministic simulated mode. When the Meta credits arrive, set `META_API_KEY` and the same flow uses the real models.

## Before you start (2 minutes)

```bash
npm install
npm run dev          # or: npm run build && npm start (single instance, most stable)
```

- Open `/command-center` in one window (full screen) and `/citizen` in a phone-sized window or on your phone (same network).
- Click **Reset demo** so the guide starts at 0/8.
- Check the mode badge in the header: `AI: SIMULATED` (no key) or `AI: META API` (key set).
- Optional: with Ollama running (`ollama pull llama3.2:3b`) set `LOCAL_LLM_URL=http://localhost:11434` to show the local Llama level during the outage step.
- If anything misbehaves live: **Reset demo**, then continue from step 1. The state is deterministic.

## Live script (the demo guide in the dashboard walks the same steps)

| Time | What you do | What you say (maps to the criterion) |
|---|---|---|
| 0:00 | Show the problem in one sentence. | *Impact:* "First 72 hours after a quake: duplicated messages, fake reports, no internet. Coordinators triage by hand." |
| 0:15 | On `/citizen` (phone): tap **Trapped → Continue → Send**. Point at "179 bytes" and the "cannot read what it relays" note. | *Depth:* "3 taps. The phone signs with Ed25519 and seals the message to the command center. Relays cannot read it." |
| 0:35 | In `/command-center`, click **Load** (step 1). The map and queue fill. Point at the Impact strip. | *Impact:* "44 SOS, 128 duplicate paths merged, people in P1/P2 cases, critical without a team." |
| 0:55 | Step 2 **Open** the false SOS. Show the confidence breakdown and the "Human review" notice. | *Depth + ethics:* "Far from the quake, joke audio, implausible relay. It is demoted and flagged, **never discarded**." |
| 1:10 | Step 3: show **Active defenses** (replay, invalid signature, burst, revoked). | *Depth:* "Blocked before they reach the queue." |
| 1:25 | Step 4 **Cut internet**. Badge changes to `OFFLINE: LOCAL LLAMA` (or `RULES`). Send another SOS from the phone. | *Meta AI:* "Level 1 is Meta's API, level 2 is an open Llama running locally, level 3 is keyword rules. The queue never stops." |
| 1:45 | Step 4 again **Restore**, then step 5 **Recommend**. Accept one suggestion (step 6). | *Meta AI:* "Muse Wonder proposes the assignment as structured JSON, validated; invalid or double-booked suggestions are dropped. A person accepts." |
| 2:05 | Step 7 **Run on a case**: sample photo, SAM segmentation overlay, then the cross-check verdict and the confidence change. | *Meta AI (beyond a basic integration):* "SAM 3.1 segments the photo; Wonder compares photo, audio and report and moves confidence. It can raise or lower it, never delete." |
| 2:30 | Step 8 **Generate** the shift handover report. | *Meta AI + Impact:* "A long-context briefing for the next shift, written from live numbers." |
| 2:45 | Show **Benchmark 100 SOS** result. Close on the roadmap line. | *Demo + Depth:* "100 SOS prioritized in about 100 ms vs about 200 minutes by hand (assumed 2 min each). Native mesh app is next." |

## Video storyboard (2:30)

1. **0:00–0:10** Black title card "Solaris", one-line problem statement.
2. **0:10–0:35** Phone screen recording: 3 taps, packet size, transparency note.
3. **0:35–1:05** Dashboard: load scenario, queue and map, impact strip.
4. **1:05–1:25** False SOS: confidence breakdown, "never discarded".
5. **1:25–1:45** Internet cut: badge changes, queue keeps working.
6. **1:45–2:10** Recommend → accept; photo → segmentation → cross-check.
7. **2:10–2:25** Handover report and benchmark numbers.
8. **2:25–2:30** Card: architecture diagram (built vs roadmap) and repo URL.

Record at 1080p, mouse movements slow, no cuts inside a single action. Record the **simulated** run first (it is deterministic), then re-record the Meta API run as a bonus once the key works.

## Backup plan

| Risk | Mitigation |
|---|---|
| Wi-Fi or API failure | The app runs fully on `localhost`; with no key or no network it falls back to simulated/rules. The badge always says which. |
| Meta API slow or erroring | Every AI call has a timeout and falls back to rules; the dashboard shows "The AI failed (stage); the system continued with rules" instead of breaking. |
| State got messy | **Reset demo**, then step 1. |
| Phone camera/mic blocked | The citizen flow works with buttons only; audio is optional. |
| Deployed instance misbehaves | Serverless instances do not share memory: either set the Supabase variables (see `docs/DEPLOYMENT.md`) or demo from one machine with `npm run build && npm start`. |

## Criteria checklist

- **Impact (30 %):** `docs/IMPACT.md`; Impact strip in the dashboard; pilot plan.
- **Meta AI tools (25 %):** Spark triage, Voice Transcribe with keyword biasing, Wonder assignment + multimodal cross-check + handover report, SAM 3.1 segmentation, local Llama as level 2; structured JSON everywhere, validated with Zod.
- **Technical depth (20 %):** real Ed25519/sealed-box packets (179 bytes), secure ingestion, mesh flooding model, three-level degradation, evaluation harness against human labels, Supabase repository, PWA, tests.
- **Demo (25 %):** this script, the in-app guide, reset button, deterministic simulated mode, video storyboard.
