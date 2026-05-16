-- Defence Package — admin transparency Phase 1 + drift fix
--
-- Adds an explicit opt-in flag for DB rows that deliberately diverge
-- from the file default in lib/defence/reasonCodes/. The CI drift guard
-- (lib/defence/__tests__/promptModuleDrift.test.ts) ignores rows with
-- this flag set; the admin drift banner highlights only undeclared
-- drift. The "Reset to file default" action in the module editor
-- inserts a new row with intentional_override=false; manual saves
-- through the editor set it to true.
--
-- Background:
--   - Discovered 2026-05-16: defence_prompt_modules row for
--     visa_10_4_fraud (v1) ships an older prompt to Claude than the
--     file default at lib/defence/reasonCodes/visa_10_4_fraud.ts.
--     Admin showed only the DB row, so the drift was silent.
--   - This migration is the foundation for the drift fix; the reconcile
--     script (scripts/reconcile-defence-prompt-modules.mts) promotes
--     current file defaults to new active rows after this migration.

alter table defence_prompt_modules
  add column if not exists intentional_override boolean not null default false;

comment on column defence_prompt_modules.intentional_override is
  'When true, this DB row deliberately diverges from the file default in lib/defence/reasonCodes/. The CI drift guard ignores rows with this flag set. Reset-to-file action sets it back to false.';
