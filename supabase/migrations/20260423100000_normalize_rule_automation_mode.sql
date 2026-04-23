-- Normalize existing rule automation modes to the two-mode model.
--
-- Background: in 2026-04 we collapsed the merchant-facing automation modes
-- from four legacy values (auto_pack, notify, manual, old "review") down to
-- two (auto, review). The application layer already normalizes on read via
-- `lib/rules/normalizeMode.ts`, and every write path (zod schemas,
-- `/api/rules`, `replacePackAutomationRules`, `/api/setup/coverage-rules`)
-- now only persists "auto" or "review".
--
-- This migration is the one-shot cleanup:
--   1. rewrite any legacy values still sitting on disk, and
--   2. add a CHECK constraint so legacy values can never be reintroduced
--      even if a future code path forgets to normalize.
--
-- Mapping (matches normalizeMode() exactly):
--   auto_pack            -> auto
--   notify, manual       -> review
--   anything else / null -> review
--
-- Forward-only. No downgrade: the legacy four-mode model was removed from
-- product surface and re-introducing it would be a regression.

-- 1. Rewrite existing rows ----------------------------------------------

-- auto_pack -> auto
UPDATE rules
   SET action = jsonb_set(action, '{mode}', '"auto"'::jsonb, true)
 WHERE action ? 'mode'
   AND action->>'mode' = 'auto_pack';

-- notify / manual -> review
UPDATE rules
   SET action = jsonb_set(action, '{mode}', '"review"'::jsonb, true)
 WHERE action ? 'mode'
   AND action->>'mode' IN ('notify', 'manual');

-- Anything else that isn't already auto or review -> review.
-- Includes rows where `mode` is missing entirely (we default to review
-- everywhere in app code, so the DB should agree).
UPDATE rules
   SET action = jsonb_set(
         COALESCE(action, '{}'::jsonb),
         '{mode}',
         '"review"'::jsonb,
         true
       )
 WHERE action IS NULL
    OR NOT (action ? 'mode')
    OR action->>'mode' NOT IN ('auto', 'review');

-- 2. Lock the column so legacy values can never come back --------------
--
-- `action` is jsonb and the rest of its shape (pack_template_id,
-- require_fields, etc.) is validated by application-layer zod, so we only
-- pin the `mode` key here. Using NOT VALID + VALIDATE splits the lock so
-- the ALTER is non-blocking on large tables (VALIDATE only takes a SHARE
-- UPDATE EXCLUSIVE lock).

ALTER TABLE rules
  DROP CONSTRAINT IF EXISTS rules_action_mode_valid;

ALTER TABLE rules
  ADD CONSTRAINT rules_action_mode_valid
  CHECK (
    action IS NULL
    OR NOT (action ? 'mode')
    OR action->>'mode' IN ('auto', 'review')
  )
  NOT VALID;

ALTER TABLE rules
  VALIDATE CONSTRAINT rules_action_mode_valid;

COMMENT ON CONSTRAINT rules_action_mode_valid ON rules IS
  'Only "auto" or "review" may be stored as rules.action->>''mode''. '
  'Legacy values (auto_pack, notify, manual, old review) were collapsed '
  'in migration 20260423100000. See lib/rules/normalizeMode.ts.';
