-- ─────────────────────────────────────────────────────────────────────────
-- Canonical package identity on defence_packages (CP-B, PR 2).
--
-- WHAT THIS IS FOR. `selectFileablePackage` answers "what, if anything, may be
-- filed" by comparing a candidate row against the CURRENT pipeline inputs. It
-- cannot do that unless the row records which argument plan it was built from
-- and what the deterministic document validator said about it. Today it records
-- neither, so every candidate would have to be treated as current — which is
-- precisely the "take the newest and hope" behaviour the selector replaces.
--
-- ADDITIVE ONLY, AND NULLABLE ON PURPOSE. Every column is nullable with no
-- default and no backfill. A legacy package therefore carries NULL, which
-- `evaluateFreshness` reads as `snapshot_absent` — non-fileable. That is the
-- kickoff decision (plan §1A, hash migration): current open unsubmitted cases
-- are REBUILT before activation; legacy packages are not grandfathered and are
-- expected to go stale. A DEFAULT here would be a grandfathering escape hatch
-- wearing a schema hat, and it would mark 61 packages current that no plan was
-- ever derived for.
--
-- SAFE UNDER THE DARK PERIOD. Nothing reads these columns while
-- CANONICAL_PIPELINE is off, so applying this migration ahead of activation
-- changes no behaviour. It is applied first precisely so the pre-activation
-- rebuild (plan §9.3) has somewhere to write.
-- ─────────────────────────────────────────────────────────────────────────

alter table defence_packages
  -- The persisted CaseArgumentPlanSnapshot this package is a projection of.
  -- Stored whole rather than as scattered columns because the plan's
  -- `excluded[]` (with each record's reason) is what lets a rebuild PROVE no
  -- sentence survived its support, and a reason that only exists in a log line
  -- cannot be asserted on.
  add column if not exists plan_json jsonb,

  -- The plan's inputHash — the ONLY staleness signal. Compared, never parsed.
  -- Distinct from `evidence_hash`: that one is over positional EvidenceFact ids
  -- and is the direct cause of R4's fleet-wide rotation; this one sorts on the
  -- source-derived recordId and is stable under iteration order.
  add column if not exists plan_input_hash text,

  -- Policy version in force when the plan was derived. A policy bump
  -- invalidates a snapshot even when every input is identical, which a hash
  -- alone cannot express.
  add column if not exists plan_policy_version integer,

  -- `plan.deadlineOnly`, denormalised onto the row.
  --
  -- Denormalised deliberately: the selector must answer "may the NORMAL trigger
  -- file this candidate" without parsing a jsonb blob per candidate, and the
  -- answer is a property of the package as built, not of whatever the plan
  -- looks like now.
  add column if not exists plan_deadline_only boolean,

  -- `plan.noSafeArgument`, or NULL when a safe argument remained. Recorded so
  -- "we will not add a defence package" can be explained to the merchant with
  -- the reason the derivation actually produced, rather than re-derived later
  -- from a plan whose inputs have since moved.
  add column if not exists plan_no_safe_argument text,

  -- `validatePackageDocument`'s verdict, run AFTER composition.
  --
  -- NULL is NOT "passed". "Never validated" and "validated and passed" are
  -- different states and the selector refuses both — `validationPassed !== true`
  -- — because absence of a verdict is not evidence of a good one.
  add column if not exists document_validation_passed boolean,

  -- The machine failure codes behind that verdict. Carried separately from the
  -- boolean so P-6's `noUnsupportedArgument` can be answered 1:1 (orphaned /
  -- unsupported / unauthorized claim) instead of being folded into "validation
  -- passed", which is the collapse contract revision 1 undid.
  add column if not exists document_failure_codes jsonb;

comment on column defence_packages.plan_json is
  'CaseArgumentPlanSnapshot this package projects. NULL = built before the canonical plan existed; non-fileable, not grandfathered.';
comment on column defence_packages.plan_input_hash is
  'Plan inputHash. Opaque: compare only, never parse or order by it.';
comment on column defence_packages.document_validation_passed is
  'validatePackageDocument verdict. NULL means never validated and is refused exactly like false.';

-- The selector reads every version for a dispute and takes the highest, so it
-- can detect the ambiguous case (two rows at the same version) rather than
-- silently picking one. That is a per-dispute scan ordered by version.
create index if not exists defence_packages_dispute_version_idx
  on defence_packages (dispute_id, version desc);

-- Partial index for the pre-activation rebuild's work-list: open, unsubmitted
-- packages that carry no plan yet.
create index if not exists defence_packages_missing_plan_idx
  on defence_packages (dispute_id)
  where plan_input_hash is null;
