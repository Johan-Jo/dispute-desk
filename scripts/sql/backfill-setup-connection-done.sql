-- Backfill: shops that finished the wizard (activate done) but never recorded
-- the connection step were wedged in the dashboard→wizard loop. Step 1 didn't
-- persist (fixed in ConnectionStep). Mark connection done for those rows so
-- allDone can resolve true. Idempotent — only touches rows still missing it.
update shop_setup ss
set
  steps = jsonb_set(
    coalesce(ss.steps, '{}'::jsonb),
    '{connection}',
    jsonb_build_object(
      'status', 'done',
      'payload', jsonb_build_object('backfilledAt', to_jsonb(now())),
      'completed_at', to_jsonb(now()),
      'skipped_reason', null
    ),
    true
  ),
  updated_at = now()
where coalesce(ss.steps -> 'activate' ->> 'status', 'todo') = 'done'
  and coalesce(ss.steps -> 'connection' ->> 'status', 'todo') <> 'done'
returning ss.shop_id;
