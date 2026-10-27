-- Target schema for the Postgres (Supabase) repository. The MVP runs on MemoryRepository without credentials.
-- Row Level Security must be enabled and only the server (service role) may read these tables.

create table if not exists cases (
  id text primary key,                 -- msgId (hex)
  sender_key text not null,
  sent_at timestamptz not null,
  received_at timestamptz not null,
  type text not null,
  who text[] not null default '{}',
  count int not null,
  lat double precision not null,
  lon double precision not null,
  paths jsonb not null default '[]',
  status text not null default 'new',
  priority text not null default 'P3',
  needs_review boolean not null default false,
  triage jsonb,
  trust jsonb,
  transcript jsonb,
  assigned_team_id text,
  events jsonb not null default '[]'
);
create index if not exists cases_priority_idx on cases (priority, received_at);

create table if not exists field_photos (
  id text primary key,
  case_id text not null references cases(id) on delete cascade,
  uploaded_at timestamptz not null,
  storage_path text not null,          -- object in a private bucket, never a public URL
  findings jsonb not null,
  source text not null
);

create table if not exists teams (
  id text primary key,
  name text not null,
  size int not null,
  lat double precision not null,
  lon double precision not null,
  status text not null default 'available'
);

create table if not exists seen_messages (
  id text primary key,                 -- anti-replay / dedup
  first_seen timestamptz not null,
  path_keys text[] not null default '{}'
);

create table if not exists sender_events (
  sender_key text not null,
  at timestamptz not null
);
create index if not exists sender_events_idx on sender_events (sender_key, at);

create table if not exists revoked_identities (sender_key text primary key);

create table if not exists rejections (
  at timestamptz not null,
  reason text not null,
  id text                              -- msgId only; never decrypted content
);

alter table cases enable row level security;
alter table field_photos enable row level security;
alter table teams enable row level security;
alter table seen_messages enable row level security;
alter table sender_events enable row level security;
alter table revoked_identities enable row level security;
alter table rejections enable row level security;
