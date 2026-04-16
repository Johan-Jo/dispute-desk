-- Add 'saving' and 'save_failed' to the evidence_packs status constraint.
-- These were used at runtime but missing from the DB check.
alter table evidence_packs drop constraint if exists evidence_packs_status_check;
alter table evidence_packs add constraint evidence_packs_status_check
  check (status in (
    'queued', 'building', 'ready', 'failed', 'archived',
    'draft', 'blocked', 'saved_to_shopify', 'saving', 'save_failed'
  ));
