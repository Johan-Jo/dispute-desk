with norm as (
  select payment_method,
         lower(regexp_replace(btrim(payment_gateway), '[\s-]+', '_', 'g')) gw
  from shopify_orders
), proj as (
  select case
    when payment_method is not null then payment_method
    when gw is null or gw = '' then null
    when gw in ('shopify_payments','stripe','braintree','adyen','checkout','checkout_com',
                'mollie','worldpay','authorize_net','cybersource','nuvei','manual','bogus') then null
    else gw end as after,
    payment_method as before
  from norm
)
select coalesce(before,'<null>') before_val, coalesce(after,'<null>') after_val, count(*) n
from proj group by 1,2 order by n desc limit 20;
