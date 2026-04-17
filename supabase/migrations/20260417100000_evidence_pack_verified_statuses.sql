-- Add verified/unverified save statuses for post-mutation verification.
alter table evidence_packs drop constraint if exists evidence_packs_status_check;
alter table evidence_packs add constraint evidence_packs_status_check
  check (status in (
    'queued', 'building', 'ready', 'failed', 'archived',
    'draft', 'blocked', 'saving', 'save_failed',
    'saved_to_shopify', 'saved_to_shopify_unverified', 'saved_to_shopify_verified'
  ));
