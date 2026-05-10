-- Track ingest run lifecycle so the admin UI can show live progress when
-- the manual "Refresh now" button background-fires the ingest. The
-- /api/admin/signal-radar/refresh route now returns 202 immediately and
-- runs the ingest in `after()` — without this table the UI would have no
-- way to surface completion or errors.

create table if not exists signal_radar_ingest_runs (
  id           uuid        primary key default gen_random_uuid(),
  started_at   timestamptz not null    default now(),
  finished_at  timestamptz,
  status       text        not null
                 check (status in ('running','done','error')),
  trigger      text        not null
                 check (trigger in ('manual','cron')),
  by_platform  jsonb,
  fetched      int         not null default 0,
  inserted     int         not null default 0,
  errors       text[]      not null default '{}'::text[],
  error_message text
);

create index if not exists idx_signal_radar_ingest_runs_started_at
  on signal_radar_ingest_runs (started_at desc);

-- Server-only access; no portal/embedded client should ever read this.
alter table signal_radar_ingest_runs enable row level security;
