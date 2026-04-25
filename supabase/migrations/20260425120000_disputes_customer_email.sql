-- customer_email is used by argument generation, device-location evidence, and
-- Shopify save jobs. It was selected in app code but the column was never
-- added, which makes PostgREST return 400 for those queries.

alter table disputes
  add column if not exists customer_email text;

comment on column disputes.customer_email is
  'Customer email from Shopify dispute evidence (sync) when available.';
