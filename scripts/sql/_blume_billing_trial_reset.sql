-- Reset Blume Box (6648353c) to pre-test-subscription state:
-- the 2026-07-22 Growth subscription was created with test:true by mistake
-- (SHOPIFY_BILLING_TEST was set on prod). Clear the trial gate + episode credits
-- so the real re-subscribe grants the promised trial.
update plan_entitlements
   set trial_started_at = null,
       shopify_subscription_gid = null
 where shop_id = '6648353c-422a-4ee5-8bba-d75fee284b09';

delete from pack_credits_ledger
 where shop_id = '6648353c-422a-4ee5-8bba-d75fee284b09'
   and reference in (
     'trial_growth_34025177281',
     'monthly_growth_34025177281',
     'monthly_6648353c-422a-4ee5-8bba-d75fee284b09_2026-09-04T22:26:59Z',
     'downgrade_to_free_6648353c-422a-4ee5-8bba-d75fee284b09'
   );

select pe.plan_key, pe.subscription_state, pe.trial_started_at,
       (select coalesce(sum(l.packs),0) from pack_credits_ledger l where l.shop_id = pe.shop_id) as ledger_total,
       (select count(*) from pack_credits_ledger l where l.shop_id = pe.shop_id and l.source = 'trial') as trial_rows
  from plan_entitlements pe
 where pe.shop_id = '6648353c-422a-4ee5-8bba-d75fee284b09';
