# Threat model

Scope: the Solaris MVP (simulators, ingestion, AI, dashboard). Anything that depends on the roadmap (real BLE/LoRa mesh, native app) is flagged as such.

## Assets
- Location and personal data of people asking for help.
- Integrity of the priority queue (an attacker must not displace real cases).
- Availability of the command center during the disaster.
- The command center's private key.

## Threats and mitigations

| # | Threat | Mitigation in the MVP | Pending / roadmap |
|---|---|---|---|
| 1 | **False SOS** (jokes, invented locations, attempts to saturate the center) | Confidence score with a visible breakdown: match with a seismic event (time and space), corroboration by other senders, proximity of the first relaying node (Bluetooth range corroborates the reported location), content coherence, signature/identity. **A low-confidence SOS is never discarded**: it drops one level and is flagged for human review (so an attacker cannot "silence" real cases). The rescuer can mark a case as false. | SMS/phone verification as an extra signal. Pattern detection across identities. |
| 2 | **Sender impersonation** | Every packet carries an Ed25519 signature over header + sender key + content, verified before accepting. A signature that does not match the declared key is rejected (`bad_signature`). | Bind identity to a verified phone number; key rotation. |
| 3 | **Tampering** in transit (malicious relay) | The body is encrypted and authenticated (`crypto_box_seal`) and signed; changing the header or body breaks the signature or the decryption. Only the TTL is mutable, which is why it is outside the signature (a relay can shorten a message's life, not change its content). | A relay can drop packets; redundancy over several paths and gateways mitigates this. |
| 4 | **Replay** | The 16-byte random ID is recorded only after the signature is verified (the registry cannot be "poisoned" with forged packets). The same ID through **another path** inside the deduplication window is a legitimate duplicate (merged, and the path is counted); the same path or outside the window is a blocked replay. Timestamps outside the configurable window (`REPLAY_WINDOW_S`), past or future, are rejected. | Persistent window and registry in the database (in memory today). |
| 5 | **Network / center flooding** | Per-identity limit (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MIN`); duplicates do not consume the quota; maximum packet and batch size in `/api/ingest`; bounded audio fragments (max 16), accepted only from the sender that started the audio; identity revocation list. Per-node deduplication and TTL on the mesh prevent forwarding storms. | Per-gateway/IP limits, global quotas, edge DoS protection. An attacker with many identities remains a risk: corroboration and human review bound it. |
| 6 | **Location privacy** | Content (including location) travels encrypted towards the center's public key: relay phones and nodes cannot read it. Only the header (urgency, TTL, random ID, time) is visible. Decrypted content and keys are never logged. Relaying requires explicit permission and a visible notification. Photos are only uploaded by rescuers/drones, never by citizens. | Encryption at rest in Postgres; minimal retention; header metadata (time, urgency) is still observable. If the center is compromised, all its information is. |
| 7 | **Theft of the center key** | The private key lives only in `.env.local` (git-ignored) or in ephemeral memory; `.env.example` has no values; `generate-keys` refuses to overwrite. | Secret manager and rotation; per-shift keys. |
| 8 | **AI hallucination or medical advice** | Outputs validated with Zod; invented ids or busy teams are dropped from recommendations; a filter blocks medical language and replaces it with a safe template; if anything fails, level 3 (rules) is used. The final decision is always human. | Periodic evaluation of the filter with more cases. |
| 9 | **Internet outage** | Level 3 by rules, no AI or network; the dashboard switch demonstrates it. | Local model (L2). |
| 10 | **Malicious input** (JSON, images) | Zod on every route; images are limited to PNG/JPEG/WebP data URLs and by size; uploaded content is never executed. | Antivirus / server-side image re-encoding. |

## Trust assumptions
- The gateway and the command center are trusted; phones and relays are not.
- Phone clocks can drift: hence the wide timestamp window (10 min by default).
- The MVP keeps state in memory; restarting the server wipes cases, the replay registry and counters.
