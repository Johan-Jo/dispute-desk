-- One-shot: surasvenne reactivated Scale via callback but the callback
-- never updated subscription_state (only plan_key + cycle dates), so
-- the sticky red "subscription_expired" banner is still showing on the
-- billing page. The callback bug is fixed forward in commit (next push);
-- this fixes the merchant's current state.
--
-- shop_id e5da0042-a3d4-48f4-88f3-33632a0e12d3 = surasvenne.myshopify.com
-- Approved charge: 28797239353 (Scale, $149/mo)
update plan_entitlements
   set subscription_state = 'active',
       low_credits_banner_dismissed_cycle = null,
       grace_banner_dismissed_cycle = null,
       updated_at = now()
 where shop_id = 'e5da0042-a3d4-48f4-88f3-33632a0e12d3';

select shop_id, plan_key, subscription_state, billing_cycle_ends_at
  from plan_entitlements
 where shop_id = 'e5da0042-a3d4-48f4-88f3-33632a0e12d3';
