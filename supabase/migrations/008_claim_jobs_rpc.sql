-- 008: RPC function for atomic job claiming with SKIP LOCKED

create or replace function claim_jobs(
  p_worker_id text,
  p_limit int default 5,
  p_max_concurrent int default 1
)
returns setof jobs
language plpgsql
as $$
declare
  v_job jobs;
begin
  for v_job in
    select j.*
    from jobs j
    where j.status = 'queued'
      and j.run_at <= now()
      -- per-shop concurrency cap
      and (
        select count(*)
        from jobs j2
        where j2.shop_id = j.shop_id
          and j2.status = 'running'
      ) < p_max_concurrent
    order by j.priority asc, j.run_at asc
    limit p_limit
    for update skip locked
  loop
    update jobs
    set status = 'running',
        locked_at = now(),
        locked_by = p_worker_id,
        attempts = attempts + 1,
        updated_at = now()
    where id = v_job.id;

    v_job.status := 'running';
    v_job.locked_at := now();
    v_job.locked_by := p_worker_id;
    v_job.attempts := v_job.attempts + 1;

    return next v_job;
  end loop;
end;
$$;
