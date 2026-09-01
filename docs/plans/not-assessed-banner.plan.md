# "Not assessed yet" banner on a case that IS assessed

Status: STEPS 1-2 IMPLEMENTED (branch `fix/workspace-assessment-freshness-diagnostics`).
Cause still NOT identified — step 1 exists to name it on the next occurrence.
Step 3 (copy) NOT done.
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

## The decisive test: the server says the case IS assessed

`buildWorkspaceAssessment` — the exact function the route calls — was run over
the real prod rows for this dispute (pack sections, gate fingerprint, coverage,
waived items, persisted snapshot), using current `master` code:

    gates present      : true
    current hash       : 2a729a83f0c286a5...
    snapshot hash      : 2a729a83f0c286a5...
    snapshot policyVer : 1
    needsRecalculation : false          <-- assessed
    recalculationReason: null
    strengthBand       : weak
    readiness          : ready_with_warnings

A negative control confirms the hash is genuinely sensitive (dropping one
section, or changing the reason, both change it), so the match is real and not
an artefact of a hash that ignores its inputs.

**The server, on current code and current data, does NOT produce the banner.**

## Why this could not have been a transient input

`dispute_events` holds the complete history — four rows, one build, no rebuild:

    2026-08-27 18:22:42  dispute_opened        chargeback opened - PRODUCT_NOT_RECEIVED
    2026-08-27 18:23:37  auto_build_triggered
    2026-08-27 18:24:55  pack_created          Score: 42%, 7 evidence items
    2026-08-27 18:24:57  pack_blocked          Auto-mode case strength is Weak

The pack has been in exactly this state since 08-27. `pack_json` is written in
ONE update (`buildPack` builds the whole object, then a single `.update`), so
there is no partial-write window. The only later job (`enrich_gorgias_comms`,
08-28 18:10) writes exclusively to `gorgias_matched_tickets` /
`gorgias_evidence_messages`, neither of which feeds the hash. And the three
hash-path files (`derive.ts`, `assessmentSnapshot.ts`, `assessment.ts`) last
changed on master 08-21, 08-21 and 08-10 — all BEFORE the pack was built, so
there is no version skew between the writer and the current reader.

## Therefore

The client displayed `bodyStale`, which `bodyKeyFor` emits ONLY for
`input_hash_mismatch` or `policy_version_superseded`. The client cannot invent
that reason — `useDisputeWorkspace.ts:1182` only relays
`serverAssessment.assessment.recalculationReason`, and the one client-side
fallback (`:1020`) passes no reason at all, which resolves to `bodyAbsent`.

So the response that painted this screen carried `input_hash_mismatch`, and the
same request replayed today does not. Two candidates remain, and they are
distinguishable:

- **(A) A cached response.** The fetch at `useDisputeWorkspace.ts:388` is a bare
  `fetch()` with no `cache: "no-store"`, and the route sets no `dynamic` /
  `revalidate` / `Cache-Control`. A response produced during the ~80s build
  window (18:23:37 -> 18:24:55, when the pack row existed but `case_assessment`
  did not yet) could be served from cache long afterwards. This is the leading
  hypothesis. NOTE it predicts `snapshot_absent` -> `bodyAbsent`, so for it to
  explain `bodyStale` the cached response must have been produced when a hash
  was reconstructable but mismatched -- verify rather than assume.
- **(B) A genuine mismatch under request-time conditions not reproducible from
  persisted state.** Cannot be ruled out without the instrumentation below.

## Step 1 - INSTRUMENT (do this first; it is also cheap to ship)

Because `evaluateFreshness` collapses three hash terms into one boolean, a
mismatch is unattributable today -- which is precisely why this took a full
session and still did not yield the mechanism. In
`app/api/disputes/[id]/workspace/route.ts`, at `currentAssessmentHash`, log ON
MISMATCH ONLY:

- `disputeId`, `packId`, `packRow.updated_at`
- stored vs recomputed `inputHash`; stored vs current `policyVersion`
- **which of the three terms differs** -- recompute `modelFingerprint`,
  `gateFingerprint` and `payloadFingerprint` separately and name the offender

That last item is the whole point: it turns the next occurrence into a one-line
diagnosis. Read-only; ship to `develop` alone.

## Step 2 - KILL THE CACHE PATH (independent of cause, and likely the fix)

Regardless of (A) vs (B), a workspace response must never be served from cache:
it carries a per-merchant assessment whose staleness is the exact failure mode
this whole layer exists to prevent.

- Add `cache: "no-store"` to the fetch at `useDisputeWorkspace.ts:388`.
- Add `export const dynamic = "force-dynamic"` to the workspace route.

If (A) is the cause this fixes it outright. If (B) is, this removes a confound
that would otherwise muddy the instrumentation in step 1. Either way it is
correct on its own merits.

## Step 3 - THE COPY (ship alongside; worth doing regardless)

1. **`bodyStale` asserts a fact the product has not verified.** "The evidence on
   this case changed" is a claim about the merchant's data. What the code knows
   is "two hashes differ" -- which, as this incident proves, has other causes.
   State the state, not an unproven cause.
2. **Neither body says WHEN.** "DisputeDesk reassesses it automatically", with
   no timeframe, sitting next to a "Pack prepared" badge, reads as a
   contradiction to a merchant.
3. **The banner withdraws the send action** (`mayOfferFilingAction: false`). On
   a case the server considers `ready_with_warnings`, that is a real capability
   loss, not just wrong words -- which is why steps 1-2 matter more than 3.

Strings live in `messages/en.json` under
`disputes.assessmentState.notAssessed.*`; translate all six locales in the same
session (`[[feedback_translate_on_add]]`).

## Explicitly NOT the cause

Recorded so the next session does not re-derive them:

- NOT the `list` vs `byField` payload-shape difference (tested; both hash
  identically because the route copies whole section data into each field).
- NOT a missing `case_assessment_gates` fingerprint (present, reads back OK).
- NOT a policy-version bump (1 == 1).
- NOT a second/competing pack row (only one exists for this dispute).
- NOT `orderContext` asymmetry -- BOTH call sites omit it.
- NOT `networkReasonCode` asymmetry -- both pass `null`.
- NOT `dispute.reason` drift -- matches `pack_json.disputeReason`.
- NOT the contradiction gate -- it mutates `allSections` before BOTH the model
  derivation and the persist, so the two see the same set.
- NOT the checklist -- it feeds only counts and display rows, never the gate.
- NOT the filing path -- `caseSelectionContext.ts:221` builds both sides of its
  freshness check from the same projected object, so it is fresh by
  construction and never calls `computeAssessmentInputHash`. No open case is
  blocked from filing by this. Confirmed: 27 open disputes with a pack all
  carry a present, current-policy snapshot; 12 more have no pack (correctly
  `bodyAbsent`).
