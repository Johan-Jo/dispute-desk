# "Not assessed yet" banner on a case that IS assessed

Status: **CAUSE FOUND AND FIXED.** PR #641 changed a categorization rule
without bumping `SCORING_POLICY_VERSION`. Bumped to 2; 63 open packs need a
rebuild after deploy. Step 3 (copy) still NOT done.
Opened: 2026-09-01, from a merchant-visible banner on order #360499.

## The symptom

The Evidence tab shows, on a case whose pack carries a complete assessment:

    Not assessed yet
    The evidence on this case changed after it was last assessed, so the previous
    case strength and completeness no longer describe it. DisputeDesk reassesses
    it automatically — nothing is needed from you.

Alongside a "Pack prepared" badge — which reads as self-contradictory to a
merchant — and with the strength band, the completeness score and the filing
action all withdrawn (`resolveAssessmentGate` sets all three `false` together).

## What is established

`lib/disputes/assessmentPresence.ts` renders TWO different bodies:

- `bodyAbsent` — "not assessed yet, nothing to do" — from `snapshot_absent`
  or a `null` reason (the `default:` branch of `bodyKeyFor`).
- `bodyStale` — "the evidence changed" — reachable ONLY from
  `input_hash_mismatch` or `policy_version_superseded`.

The screenshot is `bodyStale`. So the browser genuinely received one of those
two reasons. That is the single most useful constraint we have, and it rules
out every "no pack / no snapshot / no server payload" path.

## What was checked and RULED OUT

Dispute `8d8a1db7-17b2-415a-befe-ab65b757affb`, pack
`faf3fa40-2cae-430b-9d43-00583637254f`, prod (`aokhplydttxtebvbeuzc`):

1. **The snapshot is present and current.** `case_assessment` and
   `case_assessment_gates` both present; `policyVersion` 1 == current
   `ASSESSMENT_POLICY_VERSION`; strength `weak`, readiness
   `ready_with_warnings`. So `policy_version_superseded` is out, leaving
   `input_hash_mismatch` as the only remaining producer of this copy.

2. **The hash REPRODUCES exactly.** Re-running the production code
   (`deriveCaseEvidenceModel` + `computeAssessmentInputHash` +
   `readPersistedGateFingerprint`) over the real `pack_json` reproduced the
   stored hash `2a729a83f0c286a5…` byte for byte — via the route's own
   `byField` payload construction AND via the writer's `list` form. Both match.
   (An earlier hypothesis that these two shapes hash differently was tested and
   is FALSE: the route copies whole section data into each field, so the two
   forms converge. Do not re-open that line.)

3. **Nothing mutated after the assessment.** Pack `updated_at`
   (18:24:54.497) == snapshot `computedAt` (18:24:54.494). All 7
   `evidence_items` rows predate it. `waived_items` is `[]`. Coverage
   round-trips (`not_covered` / `INACTIVE`).

4. **Only one pack exists** for the dispute, so the route's
   `order by created_at desc limit 1` cannot be selecting a different row.

5. **The deployed code is the code tested.** Working tree is identical to
   `master` across `derive.ts`, `assessmentSnapshot.ts`,
   `workspaceAssessment.ts`, `merchantProjection.ts` and the workspace route;
   the hash path last changed 2026-08-21, before this pack was built (08-27).

6. **A later job did NOT touch the hash inputs.** An `enrich_gorgias_comms`
   job ran 08-28 18:10 (after the assessment), but it writes only to
   `gorgias_matched_tickets` / `gorgias_evidence_messages` — neither feeds
   `computeAssessmentInputHash`.

7. **The filing path is NOT affected.** `caseSelectionContext.ts:221` builds
   both sides of its freshness comparison from the same projected object
   (`assessmentFromPackRow`, `computedAt = FRESH_BY_CONSTRUCTION`), so it is
   fresh by construction and never calls `computeAssessmentInputHash`. This is
   a DISPLAY defect, not a silent non-filing incident. Confirmed separately:
   all 27 open disputes that have a pack carry a present, current-policy
   snapshot; 12 more have no pack at all (those correctly render `bodyAbsent`).

## THE CAUSE

**PR #641, merged to `master` 2026-08-31**, changed `ip_location_check`
categorization for a clean `same_country` fact from `supporting` to `moderate`
(`lib/argument/canonicalEvidence.ts:622`). It did not bump
`SCORING_POLICY_VERSION`.

That category reaches the assessment input hash:

    categorizeEvidenceField -> "moderate"
      fromLegacyCategory    -> quality "corroborating"   (was "contextual")
        modelFingerprint    -> hashes `quality` per record
          inputHash differs -> input_hash_mismatch
            bodyStale       -> "The evidence on this case changed"

The reported pack was built **08-27**, storing a hash computed while the field
was `contextual`. #641 shipped **08-31**. The merchant viewed it **09-01**. The
snapshot never changed; the rules for deriving its hash did, underneath it.

Proven directly: on a branch containing #641 the field derives as
`corroborating` and the hash is `69fac7a0…`; the stored value is `2a729a83…`.
Same pack, same data, different code.

**Why the earlier reproductions said "MATCH".** They ran on
`promote/csv-fixes`, which predates #641, so they faithfully reproduced the OLD
hash. A `git show master:` check compounded it by reading a stale local
`master` ref that had never been fetched — it showed `supporting`, which
appeared to rule prod out. Both checks were wrong in the same direction. The
moment the work moved to a branch off `origin/develop`, the same script flipped
to MISMATCH; that flip is what exposed it. **Lesson: verify against
`origin/<branch>`, never a local ref, when asking "what is deployed?"**

## Blast radius (prod, measured)

63 open unsaved `ready` packs carry a policy-version-1 snapshot — 33
`under_review`, 30 `needs_response`. All showed "Not assessed yet" with the
strength band, completeness score and send action withdrawn. (13 more sit on
decided disputes and do not matter: their evidence is already filed.)

By IP tier: 55 open packs hold `same_country`, 20 `same_city`, 1
`different_country`.

## The fix (implemented)

1. **`SCORING_POLICY_VERSION` 1 -> 2** (`lib/evidence/model/assessment.ts`).
   `evaluateFreshness` checks `policyVersion` BEFORE `inputHash`, so an old
   snapshot now reports `policy_version_superseded` — the truthful reason,
   which routes to the "not yet assessed" copy instead of the false "your
   evidence changed" one. This is exactly the case the field exists for.
2. **Rebuild** via `scripts/rebuild-policy-v2-stale-packs.mjs`. A bump makes
   the copy honest but re-derives nothing — only `buildPack` writes the
   snapshot, and the nightly `refresh-open-disputes` cron rebuilds only on a
   carrier delivery change, so these never self-heal. Dry-run by default;
   `--limit=N` for a canary; `--apply` to enqueue at `priority: 90`.
   **Must run AFTER the bump deploys** — rebuilding first re-writes version 1.
   `buildPack` does not consume pack quota, so no merchant credits are spent.
   Dry-run against prod: 63 scanned, 63 stale — matching the SQL census.
3. **Regression tests** pin that a record's `quality` reaches the input hash,
   and that a policy bump alone yields `policy_version_superseded` rather than
   `input_hash_mismatch` on byte-identical inputs.
4. **Diagnostics** (first commit on this branch) would have printed
   `movedTerms: ["model"]` on the first page load. Retained: they turn the next
   occurrence into a one-line diagnosis.

## Scope checked

The bump touches only the workspace read path. The filing selector compares
`plan.policyVersion` (`caseSelectionContext.ts:227`) and the automation
decision carries its own `AUTOMATION_POLICY_VERSION`. Neither is affected; no
case is blocked from filing.

## The class, not the instance

The defect is not "#641 forgot a bump" — it is that nothing made the coupling
visible. `categorizeEvidenceField` decides a category, the category becomes a
`quality`, and `quality` is hashed; none of that is apparent from the file
being edited. The rule is now stated at `SCORING_POLICY_VERSION`, in
`docs/technical.md`, and pinned by a test asserting the categorization ->
hash chain is live.

## Still open

**Step 3, the copy.** Two problems independent of this cause:

1. `bodyStale` asserts *"The evidence on this case changed"* — a claim about
   the merchant's data that the code does not verify. What it knows is that two
   hashes differ, which has other causes, as this incident proves.
2. Neither body says WHEN reassessment happens, which reads as contradictory
   next to a "Pack prepared" badge.

Strings live at `disputes.assessmentState.notAssessed.*`; all six locales in
the same session.

## Explicitly NOT the cause

Recorded so they are not re-derived: the `list` vs `byField` payload shape
(both hash identically); a missing gate fingerprint; a competing pack row;
`orderContext` / `networkReasonCode` asymmetry; `dispute.reason` drift; the
contradiction gate; the checklist; response caching (a real weakness, fixed in
the first commit here, but not this).

**The filing path was never affected.** `caseSelectionContext.ts:221` builds
both sides of its freshness check from the same projected object, so it is
fresh by construction and never calls `computeAssessmentInputHash`.
