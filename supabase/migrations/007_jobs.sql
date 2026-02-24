-- 007: async jobs table for pack build, PDF render, future sync

create table jobs (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  job_type      text not null,
  entity_id     text,
  status        text not null default 'queued'
                  check (status in ('queued','running','succeeded','failed')),
  priority      int not null default 100,
  run_at        timestamptz not null default now(),
  attempts      int not null default 0,
  max_attempts  int not null default 3,
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_jobs_claimable on jobs(status, run_at, priority)
  where status = 'queued';
create index idx_jobs_shop_status on jobs(shop_id, status);

alter table jobs enable row level security;

create policy "service_role_full_access_jobs"
  on jobs for all
  using (true)
  with check (true);
