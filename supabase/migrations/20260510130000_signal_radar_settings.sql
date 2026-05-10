-- Signal Radar — admin-controlled toggles for sources + crons.
-- Singleton row (id=1) holds the on/off state for each ingest source and
-- the two cron schedules. Adapters skip work when their flag is false;
-- crons return early with { skipped: true }.

create table signal_radar_settings (
  id                          smallint    primary key default 1 check (id = 1),
  -- Sources
  shopify_community_enabled   boolean     not null default true,
  app_store_enabled           boolean     not null default true,
  reddit_enabled              boolean     not null default true,
  hackernews_enabled          boolean     not null default true,
  -- Crons
  reddit_cron_enabled         boolean     not null default true,
  classify_cron_enabled       boolean     not null default true,
  updated_at                  timestamptz not null default now()
);

insert into signal_radar_settings (id) values (1)
on conflict (id) do nothing;

alter table signal_radar_settings enable row level security;

create policy service_role_all_signal_radar_settings
  on signal_radar_settings for all
  using (true)
  with check (true);
