-- Resubmission Window: rebuild_pending flag on evidence_packs.
--
-- Tracks a pending merchant regeneration request. The flag has a
-- deliberate dual meaning, both clearing at the same point
-- (`handleBuildPack` start, where `evidence_packs.status` flips to
-- 'building'):
--
--   - Idle state: a regenerate request arrived while the pack was at
--     `saved_to_shopify_verified`. The endpoint sets the flag + enqueues
--     a `build_pack` job. The flag stays true until the worker picks it
--     up, at which point status='building' and the UI's "Regenerating"
--     banner stays continuous (no flicker between request and worker
--     pickup).
--
--   - In-flight state: another regenerate request arrived while the
--     pack was already in flight (e.g. status='building' or 'saving').
--     The endpoint sets the flag but does NOT enqueue (would duplicate).
--     `saveToShopifyJob`'s tail (§5c of plan) checks this flag after the
--     full save cycle completes and enqueues a fresh `build_pack` then.

alter table evidence_packs
  add column if not exists rebuild_pending boolean not null default false;

comment on column evidence_packs.rebuild_pending is
  'True when a merchant regeneration request is pending. During idle state it means a build_pack job was requested but not yet picked up. During an in-flight build/save it means another regeneration should be enqueued after the current save cycle settles.';
