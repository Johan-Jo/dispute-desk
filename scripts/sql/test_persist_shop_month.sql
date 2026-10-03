-- persist_shop_month acceptance test (docs/plans/insights-single-source.plan.md PR2).
-- Run on DEV only:
--   npm run db:query:dev -- --file scripts/sql/test_persist_shop_month.sql --output table
-- Every case runs inside one DO block on a dedicated throwaway shop row, which
-- is deleted at the end (cascade removes its rows and log). Any failed
-- assertion raises, so the query errors instead of printing the final row.
do $$
declare
  v_shop uuid;
  v_month date := '2026-09-01';
  v_vals jsonb := jsonb_build_object(
    'coverage', 'full', 'settled_count', 2686, 'card_chargeback_count', 4,
    'card_dispute_ratio', 0.00149, 'mc_ecm_ratio', 0.00061);
  v_res jsonb;
  v_rows int;
  v_logs int;
  v_failed boolean;
begin
  insert into shops (shop_domain) values ('persist-shop-month-test-' || gen_random_uuid() || '.invalid')
  returning id into v_shop;

  -- 1. First write: revision 0, row + log, hashes equal.
  v_res := persist_shop_month(v_shop, v_month, v_vals, 'test', false, 2::smallint, 'test');
  if not (v_res->>'changed')::boolean then raise exception 'case 1: first write not changed'; end if;
  select count(*) into v_logs from ratio_snapshot_revisions where shop_id = v_shop;
  if v_logs <> 1 then raise exception 'case 1: expected 1 log row, got %', v_logs; end if;
  perform 1 from ratio_snapshots r join ratio_snapshot_revisions l
    on l.shop_id = r.shop_id and l.period_month = r.period_month and l.revision = r.revision
   where r.shop_id = v_shop and l.values_hash = r.values_hash and r.card_dispute_ratio = 0.00149;
  if not found then raise exception 'case 1: row and log disagree'; end if;

  -- 2. Invalid coverage raises and changes nothing.
  v_failed := false;
  begin
    perform persist_shop_month(v_shop, v_month, v_vals || '{"coverage":"bogus","card_chargeback_count":9}', 'test', false, 2::smallint, 'test');
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'case 2: invalid coverage did not raise'; end if;
  select count(*) into v_logs from ratio_snapshot_revisions where shop_id = v_shop;
  if v_logs <> 1 then raise exception 'case 2: log changed after a failed write'; end if;
  perform 1 from ratio_snapshots where shop_id = v_shop and card_chargeback_count = 4;
  if not found then raise exception 'case 2: row changed after a failed write'; end if;

  -- 3. A ratio with 6 decimals raises (round-once guard).
  v_failed := false;
  begin
    perform persist_shop_month(v_shop, v_month, v_vals || '{"card_dispute_ratio":0.001489}', 'test', false, 2::smallint, 'test');
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'case 3: 6-dp ratio did not raise'; end if;

  -- 4. Same payload: no new revision; mark_stable sets stable_at only.
  v_res := persist_shop_month(v_shop, v_month, v_vals, 'test', true, 2::smallint, 'test');
  if (v_res->>'changed')::boolean then raise exception 'case 4: equal hash reported changed'; end if;
  select count(*) into v_logs from ratio_snapshot_revisions where shop_id = v_shop;
  if v_logs <> 1 then raise exception 'case 4: equal hash wrote a log row'; end if;
  perform 1 from ratio_snapshots where shop_id = v_shop and stable_at is not null;
  if not found then raise exception 'case 4: stable_at not set'; end if;

  -- 5. Changed payload: revision + 1, logged, row follows, stable_at kept.
  v_res := persist_shop_month(v_shop, v_month, v_vals || '{"card_chargeback_count":5,"card_dispute_ratio":0.00186}', 'late_data', false, 2::smallint, 'test');
  if (v_res->>'revision')::int <> 1 then raise exception 'case 5: expected revision 1, got %', v_res->>'revision'; end if;
  select count(*) into v_logs from ratio_snapshot_revisions where shop_id = v_shop;
  if v_logs <> 2 then raise exception 'case 5: expected 2 log rows, got %', v_logs; end if;
  perform 1 from ratio_snapshots where shop_id = v_shop and revision = 1 and card_chargeback_count = 5
     and revision_reason = 'late_data' and stable_at is not null and revised_at is not null;
  if not found then raise exception 'case 5: row did not follow the new revision'; end if;

  -- 6. The advisory lock is in the function body.
  if position('pg_advisory_xact_lock' in pg_get_functiondef('public.persist_shop_month(uuid,date,jsonb,text,boolean,smallint,text)'::regprocedure)) = 0 then
    raise exception 'case 6: advisory lock missing';
  end if;

  delete from shops where id = v_shop;
  select count(*) into v_rows from ratio_snapshots where shop_id = v_shop;
  if v_rows <> 0 then raise exception 'cleanup failed'; end if;
end $$;

select 'persist_shop_month: all 6 cases passed' as result,
       has_function_privilege('anon', 'public.persist_shop_month(uuid,date,jsonb,text,boolean,smallint,text)', 'execute') as anon_can_execute,
       has_function_privilege('authenticated', 'public.persist_shop_month(uuid,date,jsonb,text,boolean,smallint,text)', 'execute') as authenticated_can_execute,
       has_function_privilege('service_role', 'public.persist_shop_month(uuid,date,jsonb,text,boolean,smallint,text)', 'execute') as service_role_can_execute;
