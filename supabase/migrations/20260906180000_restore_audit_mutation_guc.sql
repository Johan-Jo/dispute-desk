-- Restore the pre-existing `app.allow_audit_mutation` escape hatch, which
-- 20260906170000 dropped by accident.
--
-- That migration rewrote `reject_audit_mutation()` with `create or replace`
-- to add the shop-purge flag, and in doing so replaced the whole function
-- body — including the branch honouring `app.allow_audit_mutation`, added
-- back in 20260509130000 for privileged cleanup paths.
--
-- The casualty was `delete_e2e_fixture_dispute` (20260509140000), which sets
-- that GUC and deletes fixture audit rows. It began failing with
-- `audit_events is append-only: DELETE not allowed`, turning the e2e suite
-- red — caught on the PR before it reached prod.
--
-- Both flags now coexist, with deliberately different scopes:
--
--   app.allow_audit_mutation        — DELETE *and* UPDATE. The older,
--                                     broader hatch for E2E fixture teardown
--                                     and ops wipe scripts.
--   app.allow_append_only_delete    — DELETE only. The shop purge. Narrower
--                                     on purpose: erasing a shop wholesale is
--                                     legitimate, rewriting its history is
--                                     never.
--
-- Both are transaction-scoped (`set_config(..., true)`), so neither can leak
-- past COMMIT, and ordinary application traffic sets neither.
create or replace function reject_audit_mutation()
returns trigger as $$
begin
  -- Privileged cleanup paths (E2E fixture teardown, ops wipe scripts).
  if current_setting('app.allow_audit_mutation', true) = 'on' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  -- Shop purge (admin_purge_shop). DELETE only.
  if tg_op = 'DELETE'
     and current_setting('app.allow_append_only_delete', true) = 'on' then
    return old;
  end if;

  raise exception 'audit_events is append-only: % not allowed', tg_op;
end;
$$ language plpgsql;

-- `dispute_events` never had the older GUC — only the purge flag applies —
-- but it is restated here so both trigger functions can be read side by side
-- rather than reconstructed from two migrations.
create or replace function reject_dispute_event_mutation()
returns trigger as $$
begin
  if tg_op = 'DELETE'
     and current_setting('app.allow_append_only_delete', true) = 'on' then
    return old;
  end if;

  raise exception 'dispute_events is append-only: % not allowed', tg_op;
end;
$$ language plpgsql;
