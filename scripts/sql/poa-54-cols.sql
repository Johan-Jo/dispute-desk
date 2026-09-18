select column_name from information_schema.columns
where table_schema='public' and table_name='shopify_order_risk_signals'
order by ordinal_position;
