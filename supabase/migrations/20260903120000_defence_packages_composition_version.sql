-- The fourth retry input for `evaluateGenerationGuard`.
--
-- The guard decides whether a FAILED defence package may be rebuilt by asking
-- whether any input moved since the failure. It knew three: prompt_version,
-- validator_version, evidence_hash. The composed document has a fourth — the
-- deterministic prose from the thesis-template layer — and a composed failure
-- can be caused entirely by it.
--
-- On 2026-09-02 `ecbb03aa` fixed exactly such a failure (the fallback thesis
-- said "representment", hard-banned on non-card rails) by editing one template
-- string. No prompt, validator or evidence changed, so the guard saw "same
-- attempt" and all 27 cases the defect had killed stayed permanently blocked
-- after the fix shipped — 9 of them past deadline.
--
-- NULL is deliberate and load-bearing: the guard treats an unrecorded value as
-- changed, so every package written before this column existed gets exactly one
-- rebuild under the corrected templates. That is the backfill.

alter table public.defence_packages
  add column if not exists composition_version integer;

comment on column public.defence_packages.composition_version is
  'Thesis/composition rules version in force when this package was composed '
  '(lib/defence/pdf/thesisTemplates.ts COMPOSITION_VERSION). Fourth retry '
  'input for evaluateGenerationGuard. NULL = pre-versioning, treated as '
  'changed so the package is eligible for exactly one rebuild.';
