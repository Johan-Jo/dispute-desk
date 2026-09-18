select lower(regexp_replace(btrim(payment_gateway), '[\s-]+', '_', 'g')) gw, count(*) n
from shopify_orders
where payment_method is null and payment_gateway is not null and btrim(payment_gateway) <> ''
group by 1 order by n desc;
