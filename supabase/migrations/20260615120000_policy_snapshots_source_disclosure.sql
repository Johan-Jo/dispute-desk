-- Policies → published-on-store as source of truth.
--
-- Context: the "use our templates" onboarding flow wrote DisputeDesk
-- boilerplate into policy_snapshots, and policySource then folded that
-- text into the bank-facing defense PDF. A policy that lives only in
-- our DB has no storefront URL behind it, so it isn't *citable* to a
-- bank — Shopify's refundPolicyDisclosure evidence asks "where did the
-- customer see this policy?", and a DB-only template has no "where".
--
-- This migration adds provenance + the citable live URL so the
-- collector can (a) prefer policies actually published on the store
-- (auto-ingested from Shopify's Shop.shopPolicies) and (b) exclude
-- template drafts from bank evidence. See
-- docs/plans/policies-published-source-of-truth.plan.md.
--
-- 1. `source` — where this snapshot came from:
--      shopify_published  read live off the store (highest trust; citable)
--      uploaded           merchant uploaded a file
--      external_url       merchant linked a non-Shopify-hosted URL
--      template           a DisputeDesk template draft (NOT bank evidence)
--    Default 'uploaded' is harmless: no active merchants yet, so the
--    handful (if any) of pre-existing rows just keep the conservative
--    label and get superseded by the next "refresh from store".
-- 2. `published_url` — the live storefront URL (the citable "where").
-- 3. `shopify_policy_id` — ShopPolicy.id, used to dedup on refresh.
-- 4. `policy_updated_at` — ShopPolicy.updatedAt, a staleness signal.

ALTER TABLE policy_snapshots
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS published_url text,
  ADD COLUMN IF NOT EXISTS shopify_policy_id text,
  ADD COLUMN IF NOT EXISTS policy_updated_at timestamptz;

ALTER TABLE policy_snapshots
  DROP CONSTRAINT IF EXISTS policy_snapshots_source_check;

ALTER TABLE policy_snapshots
  ADD CONSTRAINT policy_snapshots_source_check
  CHECK (source IN ('shopify_published', 'uploaded', 'external_url', 'template'));

-- Widen policy_type to include 'subscription' (Shopify SUBSCRIPTION_POLICY).
ALTER TABLE policy_snapshots
  DROP CONSTRAINT IF EXISTS policy_snapshots_policy_type_check;

ALTER TABLE policy_snapshots
  ADD CONSTRAINT policy_snapshots_policy_type_check
  CHECK (policy_type IN ('refunds', 'shipping', 'terms', 'privacy', 'contact', 'subscription'));

-- Refresh dedup lookup: latest published snapshot per shop + shopify policy.
CREATE INDEX IF NOT EXISTS idx_policy_snapshots_shopify_policy
  ON policy_snapshots (shop_id, shopify_policy_id)
  WHERE shopify_policy_id IS NOT NULL;
