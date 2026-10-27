# Deployment

Solaris keeps its working state behind the `Repository` interface (`src/lib/repo/Repository.ts`). There are two ways to run the demo:

| Mode | When | State |
|---|---|---|
| **Vercel + Supabase** (recommended for a public demo) | Serverless hosts run several instances that do not share memory, so state must live in Postgres. | `SupabaseRepository` |
| **Single instance** (`npm run build && npm start`, or `npm run dev`) | Local demo, a VPS, or any host that runs exactly one long-lived Node process. | `MemoryRepository` (no credentials needed) |

> **Why Supabase for Vercel?** In-memory state is per process. On Vercel, the request that loads the scenario and the request that polls `/api/state` can land on different instances, so the dashboard would show an empty or inconsistent queue. A shared database fixes that.

## 1. Vercel + Supabase, step by step

### 1.1 Create the database
1. Create a new Supabase project (use a **separate throwaway project** for tests, see "Running the integration tests").
2. Open **SQL Editor** and run [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) (or `supabase db push` with the CLI). It creates the tables, the `bump_metric`, `put_seen` and `reset_all` functions, enables RLS and removes anon/authenticated privileges.
3. Copy two values from **Project Settings → API**: the **Project URL** and the **`service_role` key**.

### 1.2 Configure Vercel
Add these **server-side** environment variables (Project → Settings → Environment Variables). Do **not** prefix any of them with `NEXT_PUBLIC_`.

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key |
| `CENTER_PUBLIC_KEY`, `CENTER_SECRET_KEY` | From `npm run keys`. **Required on serverless**: without them every instance generates its own ephemeral pair and packets sealed by one instance cannot be opened by another. |
| `META_API_KEY` (+ optional model overrides) | When Meta API credits are available; otherwise the AI runs in simulated mode. |
| `REPLAY_WINDOW_S`, `DEDUP_WINDOW_S`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MIN` | Optional, see `.env.example`. |

Then deploy (`vercel --prod` or push to the connected branch). The repository is selected automatically by `getRepository()` in `src/lib/repo/index.ts`: Supabase when both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, in-memory otherwise.

### 1.3 Smoke test
1. Open `/command-center` and click **Load Cali 2026 scenario**.
2. Refresh several times (it will hit different instances): the queue and metrics must stay the same.
3. In Supabase → Table Editor, `cases` should hold the scenario rows.

## 2. Security notes

- **The service-role key bypasses RLS.** It is read only in server code (`src/lib/repo/supabase.ts`, route handlers). Never import `SupabaseRepository` from a client component, never expose the key through `NEXT_PUBLIC_*`, and never commit it (`.env.local` is git-ignored).
- **RLS is enabled on every table with no policies, and `anon`/`authenticated` have no table or function privileges.** The public (anon) key therefore cannot read or write anything; only the server can.
- The RPC functions are granted to `service_role` only. If you add tables or functions, repeat the `revoke ... from anon, authenticated` / `grant ... to service_role` pattern.
- Case data includes locations of people asking for help. Keep the project private, enable Supabase's encryption at rest (default) and restrict dashboard access. Field photos are currently stored inside `cases.data` as data URLs; move them to a **private** storage bucket before any real use.
- Decrypted SOS content is never logged; repository errors only carry the operation name and the PostgREST message.
- Optional hardening: pin the project to a single region close to the Vercel region, and rotate the service-role key after the demo.

## 3. Known limits of the Supabase mode

- **Dedup/replay race.** `put_seen` is a single atomic SQL statement (insert, or append new path keys; `first_seen` is never overwritten). The ingest pipeline, however, calls `getSeen()` and then `putSeen()`, so two instances handling the *same* message at the *same instant* can both treat it as unseen. Impact is bounded: `cases.id` is the message id (primary key), so only one case row exists, and only the `accepted` counter can over-count. To close it completely, make the pipeline branch on `SupabaseRepository.claimSeen(id, rec)` (returns `true` only for the call that created the row).
- **Audio reassembly** is claimed atomically (`DELETE ... RETURNING`), so the audio of one SOS is processed once. A hostile identity that wins the race for fragment index *k* of someone else's audio id can stall that audio (the id is a random 16-byte value, so this requires knowing it).
- **No automatic pruning.** `sender_events`, `seen_messages`, incomplete `audio_fragments` and `rejections` grow during an event. For a long-lived deployment schedule cleanup (Supabase `pg_cron`), for example:

```sql
-- sender_events only matter inside the rate-limit window; seen_messages only inside the replay window
select cron.schedule('solaris-prune', '*/15 * * * *', $$
  delete from sender_events where at < (extract(epoch from now()) * 1000 - 86400000);
  delete from seen_messages where first_seen < (extract(epoch from now()) * 1000 - 86400000);
  delete from audio_fragments where created_at < now() - interval '1 hour';
$$);
```

## 4. State that is still process-local

`src/lib/server/runtime.ts` keeps a few things in memory (`globalThis.__solarisRuntime`). On a multi-instance host these are **not shared**, even with Supabase:

| Runtime field | What it is | Effect on serverless | How to move it |
|---|---|---|---|
| `audioStore` | Reassembled audio bytes per case id, used when (re)analyzing a case. | Analysis triggered on a different instance cannot find the audio, so the transcript may be missing on re-triage. | Store the assembled audio in Supabase Storage (private bucket) or an `audio_blobs` table (`case_id`, `data bytea`) and read it in `analyzeCase`. |
| `pendingAudio` | Audio that arrived before its SOS. | Lost if the SOS is handled by another instance. | Same table as above, keyed by parent id, attached when the case is created. |
| `nodes` | Mesh node positions (relay-proximity signal in the confidence score). | Without them the signal is neutral (0.5) on other instances. | A `mesh_nodes` table (`id`, `lat`, `lon`, `kind`) written by the scenario loader and read by `refreshTrust`. |
| `offline` | The "Simulate internet outage" switch. | The toggle only affects the instance that received the POST. | A one-row `settings` table, or a Vercel Edge Config / Supabase row read per request. |
| `degradations` | Last AI-fallback notes shown in the dashboard. | Per-instance view. | A small `degradations` table or reuse `rejections`-style logging. |
| `seeded` | Whether default teams were inserted. | Harmless: seeding is idempotent (`saveTeam` upserts). | None needed. |

For a one-off demo, the simplest and most reliable option is the single-instance mode below.

## 5. Single-instance fallback (no database)

Runs with no credentials; all state lives in one Node process, so it must be exactly one process.

```bash
npm install
npm run build
npm start            # http://localhost:3000
```

On a VPS use a process manager (`pm2 start npm -- start`) and a reverse proxy with TLS. Do not run it behind a load balancer with more than one instance, and do not deploy this mode to Vercel. A restart wipes all state (then click **Load Cali 2026 scenario** again).

## 6. Running the integration tests against a real project

`tests/repo.test.ts` runs the same contract suite against `MemoryRepository` always, and against `SupabaseRepository` only when all of these are set:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SOLARIS_REPO_TEST_RESET=1 npx vitest run tests/repo.test.ts
```

`SOLARIS_REPO_TEST_RESET=1` is a deliberate extra switch: the suite calls `reset_all()`, which **truncates every Solaris table**. Use a throwaway project, never the demo or production one.
