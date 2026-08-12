-- The validator's version, recorded on every defence package.
--
-- WHY. A package that failed validation is not permanently wrong — it is wrong
-- according to the rules in force when it was built. Without this column the
-- generation guard cannot distinguish "failed, and the rules have since
-- changed" from "failed, and nothing has moved", so it blocks both and a case
-- stays dead after the defect that killed it is fixed.
--
-- Measured 2026-08-12: 14 open disputes held a `failed` latest package, all
-- `validation_failed`. #12936 had been blocked three weeks past its deadline;
-- #353605 lost its deadline while two prompt versions shipped past it.
--
-- NULL means "built before validator versioning". `evaluateGenerationGuard`
-- treats NULL as "unknown, therefore different from the current version", so
-- pre-existing failures become eligible for exactly one rebuild under the
-- current rules rather than needing a manual unblock. A second failure under
-- the same validator version then blocks normally, so there is no loop.

alter table public.defence_packages
  add column if not exists validator_version integer;

comment on column public.defence_packages.validator_version is
  'lib/defence/validateNarrative.ts VALIDATOR_VERSION in force when this row was last built. NULL = pre-versioning. Read by evaluateGenerationGuard to decide whether a failed package may be regenerated.';

-- Partial index: the guard only ever asks about the latest FAILED rows.
create index if not exists defence_packages_failed_validator_version_idx
  on public.defence_packages (dispute_id, version desc)
  where status = 'failed';
