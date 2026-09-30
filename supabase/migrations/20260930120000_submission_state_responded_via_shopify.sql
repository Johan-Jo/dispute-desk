-- Fix A (docs/plans/mein-maison-status-and-no-return.plan.md): record a
-- response observed through Shopify, so disputes answered in Shopify Admin
-- stop showing as pending.
--
--   responded_via_shopify      needs_response -> under_review (deadline set),
--                              nothing sent by DisputeDesk
--   under_review_unattributed  first seen under_review with a deadline and no
--                              submission signal; responder unknown
--
-- The original CHECK was declared inline (20260413100000), so its name is
-- Postgres's default. Drop it by name if present, then re-add it.

alter table disputes drop constraint if exists disputes_submission_state_check;

alter table disputes
  add constraint disputes_submission_state_check check (submission_state in (
    'not_saved',
    'saved_to_shopify',
    'submitted_confirmed',
    'submission_uncertain',
    'manual_submission_reported',
    'responded_via_shopify',
    'under_review_unattributed'
  ));
