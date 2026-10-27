-- 0001_init: initial Solaris schema. Apply with `supabase db push` or paste into the Supabase SQL editor.
-- Keep in sync with supabase/schema.sql.

-- Security model: ONLY the server talks to these tables, using the service-role key.
-- RLS is enabled on every table with NO policies, and anon/authenticated lose all table and
-- function privileges, so the public (anon) key can read or write nothing.
--
-- Time columns are epoch milliseconds (bigint), matching the domain model, so no timezone conversion is involved.

-- A case is stored as one row: indexed scalar columns + the full domain object in `data` (jsonb).
-- Keeping the whole Case in jsonb means new Case fields persist without a schema change.
-- NOTE (MVP): field photos live inside `data` as data URLs. In production move them to a private storage bucket.
create table if not exists cases (
  id text primary key,                  -- msgId (hex)
  sender_key text not null,
  status text not null default 'new',
  priority text not null default 'P3',
  needs_review boolean not null default false,
  received_at bigint not null,
  data jsonb not null
);
create index if not exists cases_priority_idx on cases (priority, received_at);
create index if not exists cases_sender_idx on cases (sender_key);

create table if not exists teams (
  id text primary key,
  name text not null,
  size int not null,
  lat double precision not null,
  lon double precision not null,
  status text not null default 'available'
);

-- Anti-replay / dedup registry. first_seen is immutable; path_keys only grows (see put_seen).
create table if not exists seen_messages (
  id text primary key,
  first_seen bigint not null,
  path_keys text[] not null default '{}'
);

-- Per-identity rate limiting.
create table if not exists sender_events (
  sender_key text not null,
  at bigint not null
);
create index if not exists sender_events_idx on sender_events (sender_key, at);

create table if not exists revoked_identities (sender_key text primary key);

-- Audio fragments waiting to be reassembled. data = base64 of the sealed-then-opened fragment bytes.
create table if not exists audio_fragments (
  parent_id text not null,
  idx int not null,
  sender_key text not null,
  total int not null,
  data text not null,
  created_at timestamptz not null default now(),
  primary key (parent_id, idx)
);

create table if not exists rejections (
  id bigint generated always as identity primary key,
  at bigint not null,
  reason text not null,
  msg_id text                           -- msgId only; never decrypted content
);

-- Live counters (one row per metric key), bumped atomically through bump_metric().
create table if not exists metrics (
  key text primary key,
  value bigint not null default 0
);

create table if not exists seismic_events (
  id text primary key,
  data jsonb not null
);

-- ---------------------------------------------------------------------------
-- Functions (called through PostgREST RPC by the service role only)
-- ---------------------------------------------------------------------------

-- Atomic counter increment (no read-modify-write race between serverless instances).
create or replace function bump_metric(p_key text, p_by bigint default 1)
returns void
language sql
as $$
  insert into metrics as m (key, value) values (p_key, p_by)
  on conflict (key) do update set value = m.value + excluded.value;
$$;

-- Insert-if-not-exists for the replay registry. On conflict nothing is overwritten:
-- first_seen stays as it was and only the NEW path keys are appended.
-- Returns true when this call created the row (i.e. the caller is the first to see the message).
create or replace function put_seen(p_id text, p_first_seen bigint, p_path_keys text[])
returns boolean
language sql
as $$
  with r as (
    insert into seen_messages as s (id, first_seen, path_keys)
    values (p_id, p_first_seen, p_path_keys)
    on conflict (id) do update
      set path_keys = s.path_keys || array(
        select k from unnest(excluded.path_keys) k where k <> all (s.path_keys)
      )
    returning (xmax = 0) as inserted
  )
  select inserted from r;
$$;

-- Wipes all demo state (used by "Load scenario" / tests). Never exposed to anon.
create or replace function reset_all()
returns void
language sql
as $$
  truncate cases, teams, seen_messages, sender_events, revoked_identities,
           audio_fragments, rejections, metrics, seismic_events restart identity;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled everywhere, no policies => only service_role gets through.
-- ---------------------------------------------------------------------------
alter table cases enable row level security;
alter table teams enable row level security;
alter table seen_messages enable row level security;
alter table sender_events enable row level security;
alter table revoked_identities enable row level security;
alter table audio_fragments enable row level security;
alter table rejections enable row level security;
alter table metrics enable row level security;
alter table seismic_events enable row level security;

revoke all on table cases, teams, seen_messages, sender_events, revoked_identities,
  audio_fragments, rejections, metrics, seismic_events from anon, authenticated;

revoke all on function bump_metric(text, bigint) from public, anon, authenticated;
revoke all on function put_seen(text, bigint, text[]) from public, anon, authenticated;
revoke all on function reset_all() from public, anon, authenticated;
grant execute on function bump_metric(text, bigint) to service_role;
grant execute on function put_seen(text, bigint, text[]) to service_role;
grant execute on function reset_all() to service_role;
