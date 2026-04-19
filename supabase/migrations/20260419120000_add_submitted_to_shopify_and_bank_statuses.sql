-- Add `submitted_to_shopify` and `submitted_to_bank` to the normalized_status enum.
--
-- Rationale: "action_needed" (for saved_to_shopify submission state) was scary and
-- misleading — Shopify auto-submits at the deadline, so a saved evidence pack is
-- effectively a commit. "waiting_on_issuer" is jargon most merchants don't parse.
--
-- Mapping:
--   saved_to_shopify       -> submitted_to_shopify  (was: action_needed)
--   under_review / issuer  -> submitted_to_bank     (was: waiting_on_issuer)

alter table disputes
  drop constraint if exists disputes_normalized_status_check;

alter table disputes
  add constraint disputes_normalized_status_check
  check (normalized_status in (
    'new','in_progress','needs_review','ready_to_submit','action_needed',
    'submitted','submitted_to_shopify','waiting_on_issuer','submitted_to_bank',
    'won','lost','accepted_not_contested','closed_other'
  ));

-- Migrate existing rows.
update disputes
   set normalized_status = 'submitted_to_shopify'
 where normalized_status = 'action_needed'
   and submission_state  = 'saved_to_shopify';

update disputes
   set normalized_status = 'submitted_to_bank'
 where normalized_status = 'waiting_on_issuer';
