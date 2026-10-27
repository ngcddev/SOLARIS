# Impact

## The problem we are solving

In the first 72 hours after an earthquake, survivors can still be rescued, but the information that decides *who gets a rescue team first* is at its worst: phone lines are saturated, the same message arrives several times, audio clips pile up, rumors and false reports mix with real ones, and the internet may be down. Command centers triage by hand. Every minute spent reading a duplicate or chasing a joke is a minute not spent on a trapped family.

Colombia is seismically active and its recent history (for example the Popayán earthquake of 1983 and the Armenia earthquake of 1999) shows how much depends on organizing the first hours. The demo scenario is a **fictional** earthquake in Cali, built to show the failure modes, not to claim real data.

## Who benefits

| Who | How Solaris helps | Why they would use it |
|---|---|---|
| **Survivors** | A 3-tap SOS that also works as an installable web app, with audio optional and no reading required. It keeps working through a phone-to-phone mesh when towers are down (simulated here, native app on the roadmap). | It is built for panic, low mobility and low literacy, and the phone cannot leak their location to relays: messages travel encrypted. |
| **Rescue coordinators** (civil defense, firefighters, Red Cross, municipal risk offices) | One prioritized queue instead of many channels; duplicates merged; fakes flagged, not silently dropped; team assignment proposals they accept or reject. | It removes the slowest, most error-prone part of their job and never takes the decision away from them. |
| **Field rescuers and drone operators** | Photos attached to a case are segmented and cross-checked against the report, so a team does not go to a site the imagery contradicts. | It reduces wasted trips and tells them which access roads are blocked. |
| **Incoming shift** | A generated handover report with counts, risks and next actions. | Operations run for days; knowledge loss at shift change is a real risk. |

## What we measure (and what we do not claim)

Measured in this repository today (see `npm run scenario`, `npm run eval`):

- **Time to prioritize:** 100 SOS are verified, decrypted, triaged and scored in roughly 100 ms in simulated mode. Against an **assumed** 2 minutes of manual review per SOS (our estimate, to be validated with real operators), that is about 200 minutes of reading removed per 100 SOS. With the real Meta API the time is dominated by network latency, and we will report that number once we have credits.
- **Triage quality against human labels:** 63 hand-labeled cases. The rules level reaches 87.3 % exact accuracy and 100 % recall on critical (P1) cases, never more than one level off. The labels are ours; the table in `docs/EVALUATION.md` is where Meta and local Llama results will be added.
- **Defenses that protect the queue:** replays, forged signatures, bursts from one identity and revoked identities are blocked before they reach the queue; low-confidence reports are demoted and flagged for review, never discarded.

What we do **not** claim: we have not run a field trial, and the confidence weights are expert-set, not learned from real disaster data.

## Why it is safe to deploy

- **A human always decides.** The AI proposes priorities and assignments; validation and dispatch are rescuer actions.
- **No medical advice, ever.** Triage output is logistics-only, and a filter replaces any model text that sounds like medical advice with a safe template.
- **It degrades instead of failing.** Meta API → local Llama → keyword rules; any AI error falls back one level and the queue keeps working.
- **Privacy by design.** Relays cannot read messages; the center's key never leaves its environment.

## Pilot plan (proposal)

1. **Weeks 1–2: tabletop exercise** with a municipal risk-management office or civil-defense unit using the Cali scenario. Operators triage the same 44 SOS by hand and with Solaris; we compare time and agreement with the human labels.
2. **Weeks 3–6: drill with the web/PWA citizen app** during a scheduled earthquake simulation, with the command center on a laptop and the local Llama level running without internet.
3. **After the pilot:** native Android app with real Bluetooth/Wi-Fi Direct relaying, and LoRa gateways in places with no coverage.

Success metrics for the pilot: median time from SOS to a decided assignment, share of P1 cases with a team within a target window, false-SOS rate caught before dispatch, and operator-reported trust in the queue.
