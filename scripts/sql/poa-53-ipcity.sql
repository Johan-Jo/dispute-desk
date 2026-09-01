select
  count(*)                                                as risk_signal_rows,
  count(*) filter (where ip_city is not null)             as have_ip_city,
  count(*) filter (where ip_country is not null)          as have_ip_country
from shopify_order_risk_signals;
