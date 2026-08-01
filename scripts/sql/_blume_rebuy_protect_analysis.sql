-- =============================================================================
-- Blume Box: does "order was edited after checkout" correlate with Protect INACTIVE?
-- Prod (aokhply). shop_id = 6648353c-422a-4ee5-8bba-d75fee284b09
--
-- webhook_events only covers ~2026-07-20 onward, so this test is scoped to orders
-- CREATED inside that window (where we can actually observe post-create edits).
-- "edited" proxy = received an orders/updated webhook AFTER orders/create,
-- with a gap > 2 minutes (filters out the immediate post-checkout housekeeping update).
-- =============================================================================
with created as (
  select shopify_object_id as oid, min(received_at) as created_at
  from webhook_events
  where shop_id = '6648353c-422a-4ee5-8bba-d75fee284b09'
    and topic = 'orders/create'
  group by shopify_object_id
),
updated as (
  select shopify_object_id as oid, max(received_at) as last_update_at, count(*) as update_events
  from webhook_events
  where shop_id = '6648353c-422a-4ee5-8bba-d75fee284b09'
    and topic = 'orders/updated'
  group by shopify_object_id
),
classified as (
  select c.oid,
         case
           when u.oid is not null and u.last_update_at > c.created_at + interval '2 minutes'
             then 'edited_after_checkout'
           else 'not_edited'
         end as edit_class
  from created c
  left join updated u on u.oid = c.oid
),
joined as (
  select cl.edit_class,
         so.fraud_protection_level as protect_status
  from classified cl
  join shopify_orders so
    on so.shop_id = '6648353c-422a-4ee5-8bba-d75fee284b09'
   and so.shopify_order_id = cl.oid
)
select edit_class,
       count(*) as orders,
       count(*) filter (where protect_status = 'INACTIVE') as inactive,
       count(*) filter (where protect_status = 'ACTIVE')   as active,
       count(*) filter (where protect_status = 'PENDING')  as pending,
       count(*) filter (where protect_status = 'PROTECTED') as protected,
       round(100.0 * count(*) filter (where protect_status = 'INACTIVE') / nullif(count(*),0), 1) as inactive_pct
from joined
group by edit_class
order by edit_class;
