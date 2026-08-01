-- Blume Box billing/trial state after test-charge approval + downgrade to Free
select s.id as shop_id, s.shop_domain,
       pe.plan_key, pe.subscription_state, pe.trial_started_at, pe.trial_ends_at,
       pe.shopify_subscription_gid, pe.billing_cycle_started_at, pe.billing_cycle_ends_at,
       pe.cancelled_at, pe.updated_at
from shops s
left join plan_entitlements pe on pe.shop_id = s.id
where s.shop_domain like 'blume-box%';

select l.id, l.source, l.packs, l.expires_at, l.reference, l.created_at
from pack_credits_ledger l
join shops s on s.id = l.shop_id
where s.shop_domain like 'blume-box%'
order by l.created_at desc
limit 10;

select event_type, e.created_at, event_payload
from audit_events e
join shops s on s.id = e.shop_id
where s.shop_domain like 'blume-box%'
  and event_type like 'billing%'
order by e.created_at desc
limit 10;
