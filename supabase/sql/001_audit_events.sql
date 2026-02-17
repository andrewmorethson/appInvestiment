create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  run_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  raw text not null default '',
  ts_ms bigint not null
);

create index if not exists audit_events_run_id_ts_idx
  on public.audit_events (run_id, ts_ms);
