# Duplicate Evidence Basis rows — "No return initiated / Confirmed" printed twice

Status: **IMPLEMENTED** 2026-09-03 (branch `fix/evidence-basis-dup-and-tracking-link`).
Found: 2026-09-01, from a merchant-visible duplicate on the submit page and in the PDF.

## What shipped

All five steps below were implemented as written, with one correction to the
measured blast radius and one additional defect found in the same screenshot.

**Blast radius was understated.** Re-measured on prod 2026-09-03: **169 of 169**
packages carrying a `plan_json` had at least one duplicated field — not the 93
estimated below — and **59** were already `submitted`/`final`, not one. By shop:
blume-box 15 rebuildable / 58 already filed, 6a8848-dd 83 / 0, cay-collective
10 / 1. The `no_return_initiated` count in the table below is therefore a floor;
the screenshot case (`9116e6bf-…`, dispute `46caa8fe`) duplicated FOUR fields
(`customer_account_info`, `ip_location_check`, `no_return_initiated`,
`order_confirmation`), which is why the merchant saw two "IP & location
consistency" rows as well as two "No return initiated" rows.

**Step 1** landed exactly as specified: `instanceKey` takes the within-field
ordinal as its fallback and no longer receives `evidenceItemId ?? source`.
**Step 2** was honoured — no renderer-level dedup was added. **Step 3**
(fleet-wide rehash) is accepted as intended behaviour. **Step 4** is
`lib/evidence/model/__tests__/recordIdentity.test.ts`: it pins the model, the
plan (`included[]` carries ONE record id) and the rendered row, plus a
multi-instance case proving parcel A / parcel B still yield two records. Each
assertion was verified to FAIL against the pre-fix code before being kept.
**Step 5**: no backfill written; unsubmitted packages regenerate when they go
stale, and the 59 already filed cannot be recalled.

Two characterization assertions in `derive.characterization.test.ts` pinned the
old id literal (`tds_authentication#shopify_transactions`). They were asserting
the PROPERTY "stable, non-positional id", which `#0` still satisfies; the
literals were updated and the comment now records why.

## Second defect, same screenshot: the tracking link was not clickable

Reported alongside this one: *"there has to be a clickable link in the PDF that
actually works with one click… Right now, if I click it, I end up on a DHL page
with no code posted."* Two independent causes, both fixed here:

1. **It was not a link at all.** `buildEvidenceBasisRows` concatenated the URL
   into the row's `value` string, so the PDF drew it as ordinary text. The URL
   now travels on `EvidenceBasisRow.link` and both renderers emit a real
   anchor — a `/Link` + `/URI` annotation in the PDF, asserted on the rendered
   BYTES. (The first byte-level run FAILED, catching that `scripts/pdf-worker/`
   is a build artifact that `npx vitest` does not rebuild — a React-tree test
   would have passed while the shipped PDF stayed dead.)

2. **The link pointed at the wrong carrier.** The parcel's number was
   `420774699261290416102420744039` — a USPS **IMpb** barcode (`420` + ZIP
   `77469` + the 22-digit USPS number) — and the merchant's carrier string said
   "TechSHIP", so `resolveTrackingLinkUrl` built a dhl.com link. DHL Express
   cannot resolve a USPS number: hence the empty page. Prod-wide this affected
   **36,561** shipments (30,983 labelled `DHL`, 5,578 `TechSHIP`). Fixed by
   routing on the number's own format ahead of the carrier string, scoped to
   carriers that demonstrably cannot resolve it, so `dhl_ecommerce` — which
   tracks the same numbers on its own host with richer scan history — is left
   alone. An existing test had pinned the WRONG behaviour (a TechSHIP IMpb
   number asserted to resolve to dhl.com); it was pinning the URL *spelling*
   and carried an unverified claim about the carrier. Corrected, with the real
   case added.

**Not verified end-to-end:** the live carrier render. The repo's method needs a
headed real Chrome session (carriers 403 curl and headless), which this
environment could not keep alive. The format finding rests on the barcode
standard plus prod distribution, both documented above — it should be confirmed
with `node scripts/verify-tracking-links.mjs` before the prod merge.

## Symptom

The Evidence Basis section renders the same fact twice, on both the Review &
Forward page and the generated PDF:

    Evidence Basis
    No return initiated    Confirmed
    No return initiated    Confirmed

## Root cause

`makeRecords` in `lib/evidence/model/derive.ts:250` mints a record identity as

    recordId = `${fieldKey}#${instanceKey(payload, i, fallback)}`
    fallback = evidenceItemId ?? source ?? "unknown"     // line 250

`deriveCaseEvidenceModel` is fed the SAME underlying evidence from two inputs:
`sections` (from `pack_json.sections`, where `evidenceItemId` is `null`) and
`evidenceItems` (rows from `evidence_items`, which carry a uuid). For any field
whose payload has no natural instance key — `instanceKey` only supplies one for
`delivery_proof`/`shipping_tracking` (fulfillmentId/tracking number),
`customer_communication` (conversationId) and `supporting_documents`/
`product_description` (evidenceItemId/storagePath) — the fallback decides the
id. So one fact becomes two records:

    no_return_initiated#shopify_order                              (section path)
    no_return_initiated#1419a997-4874-4eae-8cb5-dfbe707022ab       (item path)

The dedup immediately below is keyed on `recordId` and its own comment states
the intent it fails to achieve (`derive.ts:329`):

    // Dedup on the stable id so a section and its mirrored evidence_item do
    // not double-count the same underlying instance.

Two different ids ⇒ no dedup ⇒ two records ⇒ two entries in the plan's
`included[]` ⇒ `selectPlanFacts` (`lib/defence/package/projectFromPlan.ts:83-109`)
resolves both and emits two facts ⇒ `buildEvidenceBasisRows` prints two rows.

Verified end-to-end on prod package `014f4e23-6b44-4095-bfa5-de1addfcb2ea`:
`plan_json.included[]` itself contains both record ids, and the two facts carry
identical values (`distinct_values = 1`).

## Blast radius (prod, measured)

Packages with a duplicated bank-eligible fact, by field:

| field | affected packages | already submitted |
|---|---|---|
| no_return_initiated | 71 | 1 |
| shipping_tracking | 8 | 0 |
| delivery_proof | 8 | 0 |
| customer_account_info | 3 | 0 |
| tds_authentication | 1 | 0 |
| fraud_risk_screening | 1 | 0 |
| refund_record | 1 | 0 |

At the label level across all packages: "No return initiated" 497 rows over 425
packages. **One package has already been filed to an issuer carrying a
duplicated row.**

Note the existing partial mitigation: `collapseDeliveryPair` in
`lib/defence/pdf/evidenceBasisRows.ts` already suppresses the
`delivery_proof` + `shipping_tracking` pair, but only because those are two
DIFFERENT categories. It cannot help here — this duplicate is within a single
category, so it slips past.

## The fix

Close the class at the identity source, not at the renderer.

### 1. Make the record identity independent of which path derived it

In `lib/evidence/model/derive.ts`, the fallback must not encode the derivation
path. `evidenceItemId` and `source` are provenance, not identity — and they are
already carried on `provenance` (`evidenceItemId`, `origin`), so nothing is lost
by dropping them from the id.

Replace the path-dependent fallback with a content-derived one: for a
single-cardinality field, the ordinal (`index`) alone is stable and identical on
both paths. Keep the natural instance keys exactly as they are — they are what
distinguishes parcel A from parcel B and must not change.

This is the minimal change that makes the dedup on line 332 actually fire, which
is what its comment already promises.

### 2. Do NOT fix this in the renderer

A label-level dedup in `buildEvidenceBasisRows` would hide the symptom while the
plan keeps carrying two record ids — and the plan is what the narrative writer,
`validateNarrative`'s referential layer and `usedFactIds` all join against. The
duplicate must not exist upstream of those.

### 3. Consequence to confirm before shipping: the hash

`recordId` feeds `modelFingerprint` (`lib/evidence/model/assessmentSnapshot.ts:200`),
so changing it changes every `inputHash` once, fleet-wide — the R4 condition the
freshness header already anticipates:

> `EvidenceFact.id` is positional and `computeEvidenceHash` sorts on it, so a
> record-id migration changes every hash once, fleet-wide.

Every open pack goes stale on deploy. That is the documented, intended
behaviour for a record-id migration (no grandfathering escape hatch).

**CORRECTED 2026-09-04 — "and rebuilds" was wrong, and it was wrong in a way
that matters.** Stale does NOT mean regenerated. Nothing in the codebase
enqueues a `build_pack` in response to an `input_hash_mismatch`:

* `evaluateFreshness` (`lib/pipeline/contracts/freshness.ts`) only *evaluates*.
  It returns a verdict; it spends nothing.
* `grep` for `input_hash_mismatch` / `inputHash` across `lib/jobs/` and every
  `app/api/cron/**` route returns no enqueue site.
* `defence-package-deadline-rebuild` scans **due-today disputes only**, and
  skips any pack touched within 6h. It does not scan the fleet and does not
  read the hash.
* `refresh-open-disputes` enqueues only when a dispute's **delivery status
  actually moves**.

So a stale hash marks a pack non-fileable until something *independently*
rebuilds it — a deadline approaching, or delivery landing — both of which
would have happened anyway. **There is no rebuild wave and no incremental LLM
spend.**

Confirmed on prod after the 2026-09-04 12:09 UTC deploy: `build_pack` jobs in
the following 12 hours = **0** (the only rows were 3 jobs at 02:00 UTC, ten
hours *before* the merge).

Note also that the "170 packages" figure counts `defence_packages` ROWS, not
disputes — several packages accumulate per dispute (draft, stale, failed,
superseded). Blume Box has 11 open disputes and dozens of package rows. Do not
read a package count as a dispute count, and do not read "goes stale" as
"regenerates".

### 4. Regression test

Pin the actual defect, not the symptom: derive a model from a section and its
mirrored `evidence_items` row for `no_return_initiated`, assert exactly ONE
record. Then assert `buildEvidenceBasisRows` emits one row. Extend the existing
`tests/unit/deliveryRowCollapse.test.ts` family, and add a case for a real
multi-instance field so the fix cannot be implemented by collapsing genuine
parcel A / parcel B into one.

### 5. Backfill

Existing `plan_json` / `facts_json` on the 93 affected packages keep their
duplicate ids until rebuilt. Unsubmitted packages will regenerate naturally once
they go stale (step 3). The one already-submitted package cannot be recalled —
no action beyond noting it.

## Out of scope

The "Not assessed yet" banner investigated in the same session is a SEPARATE
question and is NOT explained by this defect. See the session notes: the
assessment hash for dispute 8d8a1db7 reproduces exactly from `pack_json`, so
that banner has a different cause still to be found.
