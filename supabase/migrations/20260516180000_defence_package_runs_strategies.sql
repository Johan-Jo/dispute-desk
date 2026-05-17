-- Defence Package — Phase 3 strategy submodules telemetry
--
-- Records which `StrategySubmodule[]` were selected by rankStrategies()
-- on each LLM invocation. The bundle is built deterministically from
-- the family's strategy list filtered by fact-predicate gates; logging
-- the chosen keys per run gives us:
--   1. Forensic traceability for any specific representment
--      (which strategy framings did the LLM see in its system prompt?)
--   2. Aggregate prompt-cache utilisation (the keys define the cache
--      prefix; identical key sets across calls amortise cache cost)
--   3. Family-level rollout analytics (how often does each strategy
--      qualify in production?)
--
-- The column defaults to empty array so back-fill is a no-op — pre-
-- Phase-3 rows are recorded as "no strategies selected", which is
-- accurate (the bundle didn't exist).
--
-- The new family_key column on defence_packages is for admin UI grouping
-- and rollback investigation; it mirrors what familyKeyForModule(module)
-- returns at build time, so the database is the source of truth for
-- "what family did this dispute route to". Nullable for back-compat
-- with pre-Phase-3 rows.

alter table defence_package_runs
  add column if not exists strategy_keys text[] not null default '{}';

comment on column defence_package_runs.strategy_keys is
  'Phase 3+: ordered list of StrategySubmodule keys selected by rankStrategies() for this LLM call. Empty array before Phase 3 OR when the family has no strategy submodules declared.';

alter table defence_packages
  add column if not exists family_key text;

comment on column defence_packages.family_key is
  'Phase 1+: ReasonCodeFamilyKey this package was built under (e.g. unauthorized_fraud, item_not_received). Always equal to familyKeyForModule(reason_code_module) at build time. Nullable for pre-Phase-1 rows.';

-- Helpful read-side index: lookup all packages in a given family.
create index if not exists defence_packages_family_key_idx
  on defence_packages (family_key)
  where family_key is not null;
