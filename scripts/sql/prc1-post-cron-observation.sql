-- PR-C1 post-release observation. READ-ONLY — no writes, no DDL, no remediation.
--
-- Run after the 08:00 UTC deadline cron, the first run that genuinely exercises
-- the containment gate in production:
--
--   npm run db:query:prod -- --file scripts/sql/prc1-post-cron-observation.sql --output table
--
-- Released 2026-08-08T14:31Z (master afa956b5); migrations 20260807200000,
-- 20260807230000, 20260808000000 applied 14:24Z.
--
-- HOW TO READ IT
--   block_audits_*          the gate firing. NON-ZERO IS EXPECTED AND CORRECT —
--                           it is the containment refusing an unsupported claim.
--                           `by_trigger` says which path hit it; `content_vs_not`
--                           separates a real content verdict from a transient or
--                           lifecycle refusal.
--   review_required         merchant-visible consequence of a CONTENT block only.
--                           If this exceeds the count of contentBlock=true audits,
--                           something is parking disputes it should not.
--   promotions_*            the transactional path succeeding for real.
--   save_jobs_*             queue health. Queued >30 min after the cron means the
--                           worker is not draining.
--   jobs_failed_*           investigate each. `defence_package_*` reasons are the
--                           new code; anything else is unrelated.
--   dedupe_duplicates       must be 0. Non-zero means the unique index is not
--                           holding and a lost response could double-file.
--   dpkg_status/not_saved   drift vs the release-day baseline below.
--
-- BASELINE AT RELEASE (2026-08-08T14:40Z, before any cron):
--   block audits 0 · review_required 0 · promotions 0 · stuck saves 0 · failed 0
--   draft 120 · stale 59 · failed 52 · submitted 39 · superseded 8 · final 1 · skipped 1
--   open not_saved 68
--
-- NOT COVERED HERE: `finalizeRefused` and `candidates processed` are counters in
-- the deadline cron's JSON response body, not database state. Read them from the
-- cron invocation response or the Vercel runtime logs. Do not substitute a table
-- count for them.
--
-- VERDICT RULES (agreed 2026-08-08)
--   Investigate immediately if ANY of:
--     · j_jobs_failed_count > 0, or i_save_jobs_stuck > 0
--     · l_dedupe_duplicates > 0
--     · c_block_content_vs_not dominated by contentBlock=false,
--       or d_block_by_reason dominated by preflight_error
--     · e_review_required_disputes exceeds the contentBlock=true count
--   Otherwise:
--     · expected claims blocked with contentBlock=true  → PR-C1 proven in production
--     · nothing processed                               → record "not yet exercised",
--                                                          wait for the first real attempt
--   Either way: the 91 affected disputes stay untouched. No remediation from this check.

select * from (

  select 'a_block_audits_total' as "check",
         'defence_package_blocked_unsafe_claim × ' || count(*)::text as detail
  from audit_events
  where event_type = 'defence_package_blocked_unsafe_claim'
    and created_at > '2026-08-08T14:24:00Z'

  union all
  select 'b_block_by_trigger', trg || ' × ' || n::text
  from (
    select coalesce(event_payload->>'trigger', '(none)') as trg, count(*) as n
    from audit_events
    where event_type = 'defence_package_blocked_unsafe_claim'
      and created_at > '2026-08-08T14:24:00Z'
    group by 1
  ) t

  union all
  select 'c_block_content_vs_not', 'contentBlock=' || cb || ' × ' || n::text
  from (
    select coalesce(event_payload->>'contentBlock', '(unset)') as cb, count(*) as n
    from audit_events
    where event_type = 'defence_package_blocked_unsafe_claim'
      and created_at > '2026-08-08T14:24:00Z'
    group by 1
  ) t

  union all
  select 'd_block_by_reason', reason || ' × ' || n::text
  from (
    select coalesce(x.reason, '(none)') as reason, count(*) as n
    from audit_events ae
    left join lateral jsonb_array_elements_text(
      case when jsonb_typeof(ae.event_payload->'reasons') = 'array'
           then ae.event_payload->'reasons' else '[]'::jsonb end
    ) as x(reason) on true
    where ae.event_type = 'defence_package_blocked_unsafe_claim'
      and ae.created_at > '2026-08-08T14:24:00Z'
    group by 1
  ) t

  union all
  select 'e_review_required_disputes',
         'attention_reason=package_review_required × ' || count(*)::text
  from disputes where attention_reason = 'package_review_required'

  union all
  select 'f_promotions_since_release',
         'final|submitted updated since release × ' || count(*)::text
  from defence_packages
  where status in ('final', 'submitted') and updated_at > '2026-08-08T14:24:00Z'

  union all
  select 'g_finalized_audits',
         'defence_package_finalized × ' || count(*)::text
  from audit_events
  where event_type = 'defence_package_finalized' and created_at > '2026-08-08T14:24:00Z'

  union all
  select 'h_save_jobs_since_release', st || ' × ' || n::text
  from (
    select status as st, count(*) as n
    from jobs
    where job_type = 'save_to_shopify' and created_at > '2026-08-08T14:24:00Z'
    group by 1
  ) t

  union all
  select 'i_save_jobs_stuck', 'queued >30min × ' || count(*)::text
  from jobs
  where job_type = 'save_to_shopify' and status = 'queued'
    and created_at < now() - interval '30 minutes'

  union all
  select 'j_jobs_failed_count', 'failed since release × ' || count(*)::text
  from jobs where status = 'failed' and updated_at > '2026-08-08T14:24:00Z'

  union all
  select 'k_jobs_failed_detail',
         job_type || ': ' || left(coalesce(last_error, '(no error text)'), 100)
  from jobs where status = 'failed' and updated_at > '2026-08-08T14:24:00Z'

  union all
  select 'l_dedupe_duplicates', 'dedupe keys with >1 job × ' || count(*)::text
  from (
    select dedupe_key from jobs where dedupe_key is not null
    group by dedupe_key having count(*) > 1
  ) d

  union all
  select 'm_dpkg_status', st || ' × ' || n::text
  from (select status as st, count(*) as n from defence_packages group by 1) t

  union all
  select 'n_open_not_saved', 'open disputes at not_saved × ' || count(*)::text
  from disputes where submission_state = 'not_saved' and closed_at is null

) x
order by "check", detail;
