# Forwarded and decided disputes must stop speaking pre-submission vocabulary

**Status:** PLAN ONLY (v1, 2026-09-08). Not started.
**Deliverable:** once evidence is with the card network, stop rendering copy that
asks the merchant to act on a package that can no longer be changed. Three
presentation defects, one rule. **No rebuild, no regeneration, no credit spend —
this plan changes only what is displayed.**
**Deployment:** prod = `master` `93195790`. All figures read from prod
(`aokhplydttxtebvbeuzc`) on 2026-09-08.
**Reported by:** the merchant-facing screens for blume-box dispute
`4d4db363-4e0d-4d02-9af5-75497f57aa1c` (Order #345812, USD 75, FRAUDULENT).

> **Out of scope:** rebuilding or regenerating any pack. Every affected dispute
> is already forwarded or decided; its evidence cannot be changed, so a rebuild
> would spend credits re-scoring a case whose outcome is settled. Also out of
> scope: the scoring engine, evidence composition, and anything that changes
> what was filed.

---

## 1. What the merchant sees

On one dispute, forwarded to the card network on 2026-07-23:

**Evidence tab**
> Not assessed yet · **Not assessed yet**
> DisputeDesk has not assessed this case yet, so there is no case strength or
> completeness to show. It is assessed automatically once the evidence pack is
> built — nothing is needed from you.
> *Review required before submission.*

**Review and Forward tab — two banners, stacked, mutually exclusive**
> ⚠️ **Review required before this package can be filed** — "…so it will not be
> filed. **Regenerate the package** to produce a version that can be submitted."
>
> ✅ **Sent to card network** — "Defence package v1 has been forwarded by Shopify
> to the card network… **Shopify can no longer swap the forwarded PDF.**"

The amber banner instructs an action that the green banner, directly beneath it,
declares impossible.

## 2. The facts for that dispute

| Field | Value |
|---|---|
| `normalized_status` | `submitted_to_bank` |
| `submission_state` | `submitted_confirmed` |
| Shopify `status` | `UNDER_REVIEW` |
| `evidenceSentOn` | 2026-07-23T00:32:36-07:00 |
| `evidence_packs.status` | `saved_to_shopify_verified` |
| `completeness_score` | **99** |
| `pack_json.case_assessment` | **null** |

The pack was built 2026-07-21, before assessment snapshots were written. So
`resolveAssessmentGate` correctly reports "no assessment" — **the gate is not
the bug, the caller is.** This is the same distinction `docs/technical.md:2677`
already drew for decided disputes.

## 3. Blast radius (measured, prod)

**110 disputes are forwarded-but-not-decided** (`submitted_to_bank`,
`submitted_to_shopify`, `submitted`) and carry a pack. Of those, **35 have no
assessment snapshot at all**, so they render "Not assessed yet" unconditionally:

| Shop | Forwarded w/ pack | No snapshot |
|---|---|---|
| Mein Maison | 41 | 0 |
| blume-box | 38 | 7 |
| surasvenne | 29 | 28 |
| cay-collective | 2 | 0 |

Across **all** statuses, 77 packs lack a snapshot — 35 forwarded, 33 lost, 9 won.
**Not one is an open case awaiting action.** They are historical records, which
is why §0 forbids rebuilding them.

## 4. The rule

> Once `evidenceSentOn` is set, the case is with the card network. Questions
> whose only purpose is to decide whether we may still act — "is the assessment
> fresh enough to file against?", "is this package fileable?" — are no longer
> meaningful, and their answers must not be rendered as merchant-facing facts.

This is `label-fact-divergence.plan.md` §4 precedence, already written and not
implemented:

> Terminal and confirmed external states preserve their historical facts and
> **prohibit unsupported actions**.

## 5. The three defects

### 5.1 The blocker banner survives forwarding — the worst of the three

`defencePackageActionState.ts:106`:

```ts
canRegenerate =
  !input.isNetworkSubmitted && !input.isClosed && (…)   // correctly guarded
…
showReviewRequired: packageBlocked,                      // NOT guarded
```

`canRegenerate` refuses on a forwarded case; `showReviewRequired` does not.
So the banner tells the merchant to press a Regenerate button the same helper
has already disabled. The safety suppression that blocked this package
(a delivery-address claim) landed **after** the package was forwarded — it is a
correct refusal about a future filing, rendered as an instruction about a past
one.

**Fix:** gate `showReviewRequired` on `!isNetworkSubmitted && !isClosed`, the
same predicate `canRegenerate` already uses. When suppressed, the historical
fact is not lost — the green "Sent to card network" banner already states it.

### 5.2 Live-case assessment vocabulary on a forwarded case

The Evidence tab's case-summary block asks `resolveAssessmentGate` regardless of
whether the case is still actionable, then renders `not_assessed` copy —
including *"nothing is needed from you"* and *"Review required before
submission"* on a case where submission already happened.

`docs/technical.md:2677` fixed this class for **decided** disputes via
`lib/disputes/outcomeExplanation.ts`, whose three states are discriminated by
**pack presence, never by `submission_state`** (that flag is true on ~390
disputes which closed before the shop installed — gating on it would claim
credit for evidence merchants filed themselves). But that module is consumed
only by the outcome email and the won/lost hero. `lost-dispute-explanation.plan.md`
is scoped identically — hero header + email, `won`/`lost` only.

**Neither reaches `submitted_to_bank`, and neither touches the Evidence tab.**
That is the gap this plan closes.

**Fix:** extend the existing discrimination rather than inventing a fourth
overlapping mechanism.

- Reuse `outcomeExplanation`'s pack-presence discriminator; do **not** gate on
  `submission_state`, for the reason recorded at `technical.md:2690`.
- Add a `forwarded` presentation state alongside decided: evidence is with the
  network, an outcome is pending. Copy states what was filed and when — facts we
  hold — and asks for nothing.
- The Evidence tab's case-summary block consults that state **before** the
  assessment gate. The gate keeps its current behaviour for every live case.

### 5.3 Missing case strength in the list

Same root cause: no snapshot → `mayRenderVerdict` false → the strength column is
blank on those rows. On a forwarded case the honest rendering is not a blank
cell but the filed state; it follows from 5.2 and needs no separate mechanism.

## 6. Sequencing

| # | Work | Gate |
|---|---|---|
| 1 | §5.1 — one predicate, plus a test that a forwarded blocked package shows no review-required banner | `develop` |
| 2 | §5.2 — `forwarded` state + Evidence-tab consumption + locale keys (6 locales) | `develop` |
| 3 | §5.3 — list column follows from 2; verify, do not re-implement | `develop` |
| 4 | Prod promotion | **per-change approval** |

**Definition of done for step 1:** a test constructing `isNetworkSubmitted: true`
with `packageBlocked: true` asserts `showReviewRequired === false`. Without it
the guard is one refactor away from being dropped again.

Verification before "done": `npm test`, `npx tsc --noEmit`, `npm run build`,
`verify-i18n-parity`.

## 7. What this plan does not claim

It does not claim the affected disputes were mishandled. The evidence was built,
saved and forwarded correctly; `4d4db363` was filed with completeness 99 and is
awaiting a network decision. **Only the description of that state is wrong.**

It also does not claim the assessment gate is defective. `assessmentPresence.ts`
answers the question it is asked, correctly, and continues to gate every live
case unchanged. The defect is asking it at all once the answer can no longer
change anything — the same conclusion `technical.md:2677` reached for decided
disputes, applied to the forwarded ones it did not cover.
