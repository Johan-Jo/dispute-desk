-- Fix C4 / C4b (docs/plans/mein-maison-status-and-no-return.plan.md).
--
-- C4: a shop that takes return and refund requests by email, chat or phone
-- says so. Default off: most shops handle returns through Shopify, and for
-- them "no return recorded in Shopify" keeps its scoring weight.
--
-- C4b: per dispute, the merchant confirms whether the customer asked for a
-- return or refund before the dispute. Its own table, not evidence_items: a
-- pack rebuild deletes and re-creates evidence_items and folds manual rows
-- into one nested row (same reasoning as dispute_bank_claims). One row per
-- (dispute, response cycle): a reopen asks again.
--
--   no_request_received  bank-facing: the one attributed absence sentence
--   request_received     NEVER bank-facing (it would be a confession); the
--                        no-return fact is dropped from score and letter
--   not_sure             recorded, treated as unanswered

alter table shop_settings
  add column if not exists returns_outside_shopify boolean not null default false;

create table if not exists dispute_return_request_confirmations (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references disputes(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  response_cycle int not null default 1,
  answer text not null check (answer in ('no_request_received', 'request_received', 'not_sure')),
  note text,
  answered_at timestamptz not null default now(),
  answered_by text not null default 'merchant',
  unique (dispute_id, response_cycle)
);

alter table dispute_return_request_confirmations enable row level security;
drop policy if exists service_role_full_access_dispute_return_request_confirmations
  on dispute_return_request_confirmations;
create policy service_role_full_access_dispute_return_request_confirmations
  on dispute_return_request_confirmations for all
  to service_role
  using (true)
  with check (true);
