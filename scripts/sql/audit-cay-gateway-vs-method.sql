-- Which payment GATEWAY processes cay-collective's card volume?
-- If card orders run through a non-shopify_payments gateway, Shopify never sees
-- their chargebacks (they're handled by that processor off-platform), which would
-- explain zero card disputes in Shopify Payments.
select
  coalesce(payment_gateway, '(null)') as gateway,
  case
    when payment_method ilike 'klarna%' then 'klarna'
    when payment_method in ('card','apple_pay','shopify_pay') then 'card_rail'
    else coalesce(payment_method, '(other)')
  end as channel,
  count(*) as orders
from shopify_orders
where shop_id = 'c497df8d-632d-49da-b385-eb523f57f341'
group by 1, 2
order by orders desc;
