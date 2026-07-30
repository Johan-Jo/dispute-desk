# Cited evidence must ship — Gorgias citation/exhibit integrity

**Status:** SCOPED — held, not started
**Date:** 2026-07-29 · **amended 2026-07-30** (§2b added; PR-3's "false positives are
harmless" invariant retracted; §4 risk framing corrected)
**Trigger:** prod dispute `29aca84c-3547-4ddc-8100-41f6530b1a52` (blume-box, order #347844, $251.80, Visa 4837 FRAUDULENT)
**Prod refs:** defence package `7ed2bcda-50b7-4da0-8636-d26ebd05fc4b` v2, `submitted`, `saved_to_shopify_verified`

---

## 1. What happened

The submitted defence letter argues, in `communicationArgument` and in the Evidence
Basis row, that *"the merchant's records include customer correspondence in which the
cardholder acknowledges the order."* No correspondence was attached to the submission.
The bank received an assertion with no exhibit.

Separately, a second Gorgias message on the same dispute — the merchant's own reply —
was never surfaced to the merchant, and its content contradicts the case being argued:

> "our system flagged it as potentially fraudulent so you order was cancelled… While a
> chargeback is active, we're unable to process a refund… If you'd prefer for us to issue
> the refund directly, the chargeback would first need to be withdrawn."

The order was **cancelled and never fulfilled**. The case was scored `weak`, auto-saved
to Shopify, and argued as a cardholder-authorized transaction.

### Verified evidence chain

| Finding | Verified at |
|---|---|
| Letter cites communication | `defence_packages.narrative_json` → `communicationArgument`, `usedFactIds: ["f8"]` |
| Fact `f8` is bank-eligible | `facts_json[8]`: `source: gorgias`, `strength: strong`, `bankEligible: true`, `includeInBankNarrative: true` |
| Submission carried ONE file | `shopify_response`: single `fileGid …9216524481` (the defence PDF) |
| PDF renders no excerpt | `lib/defence/pdf/` — zero hits for `conversations` / `excerpt` |
| Excerpt exists and is approved | `gorgias_evidence_messages` id `ed66c5db…`, `review_status: approved`, `approved_excerpt` non-null, hash-matched |
| Counts lost in transit | `f8.messageCount = null`, `lastMessageAt = null` |
| Contradicting message hidden | `gorgias_evidence_messages` id `45688845…`, `review_status: candidate`, never surfaced |
| No attention reason set | `disputes`: `needs_attention = true`, `attention_reason = NULL` |

---

## 2. Root causes (four distinct defects)

### RC-1 — The file-attachment layer was built but never wired in (**root cause of the contradiction**)

`lib/shopify/decideFileAttachments.ts` is a complete, tested policy brain.
`lib/packs/generateEvidenceAttachmentPdf.ts` is a complete PDF facade with a
`communication` layout. Neither is ever called on the write path.

- `isFileEvidenceAttachmentsEnabled()` is read by exactly one caller —
  `app/api/disputes/[id]/workspace/route.ts:607`, a **read** route doing an OAuth-scope
  preflight. It is never read by `lib/jobs/handlers/saveToShopifyJob.ts`.
- `saveToShopifyJob` uploads exactly one file (the defence PDF, lines 251–274) and has
  no `decideFileAttachments` import.
- `FILE_EVIDENCE_ATTACHMENTS_ENABLED=""` in `.env.production.local` (off).

Traced through `decide()` with this dispute's real inputs, **every gate would have
passed**: not covered, not fatal-loss, `caseStrength: weak` with a `strong`-priority
candidate (`customerConfirmsOrder: true` → `categorizeEvidenceField` → `strong`),
`customer_communication` → `customerCommunicationFile`, which is in
`FRAUD_VERIFIED_SLOTS`. The attachment would have shipped. There was no caller.

### RC-2 — Citation and exhibit are decided by two unaware code paths

`includeInBankNarrative` is set by the fact classifier with no knowledge of whether an
exhibit will render. Nothing asserts the invariant. This is the class defect: RC-1 is
one way it manifests, but any future renderer/collector drift reproduces it.

### RC-3 — Gorgias comm counts silently dropped

`gorgiasCommSource.buildSnapshotSection` writes counts to
`data.summary.{messageCount,customerMessageCount}` (line ~305).
`factClassifier.ts:274` reads `p.messageCount` / `p.lastMessageAt` **top-level** → both
`null`. The letter cannot date the correspondence. The LLM flagged this in its own
`warnings[]` and cited the fact anyway.

### RC-4 — Fatal-loss gate can't see a cancelled order

`lib/automation/fatalLoss.ts` has two triggers; `inr_no_fulfillment` requires an INR
reason code. This dispute is `FRAUDULENT` → gate never fires. A cancelled, never-shipped
order was argued as authorized.

The module docstring already lists *"Valid cancellation before billing"* as a known
deferred trigger with the note "no source today" — that note is now stale:
`OrderDetailNode.cancelledAt` is already queried (`lib/shopify/queries/orders.ts:17`)
and typed (line 349). No schema change needed.

### RC-5 (secondary) — attention flag set with no reason

`needs_attention = true` with `attention_reason = NULL` gives the UI nothing to render,
which is why Status & Next Step said only "DisputeDesk will continue monitoring".
`GORGIAS_EVIDENCE_READY` already exists in the taxonomy and did not fire.

---

## 2b. What "hold it" actually means — revised 2026-07-30

This plan was written on 2026-07-29 assuming that when DisputeDesk declines to file, nothing
is filed. **That is false**, and it changes how two of the three PRs should be argued.

**If no evidence is submitted by the due date, Shopify auto-compiles the order data it can
scrape and sends that to the issuer itself**
([Shopify Help Centre](https://help.shopify.com/en/manual/payments/chargebacks/chargeback-process)).
There is no accept/concede mutation in the Admin API — `ShopifyPaymentsDispute` exposes only
`disputeEvidenceUpdate`, and accepting a chargeback exists solely as a manual button in
Admin. So the choice a guard makes is never *submit vs. stay silent*. It is **our document
vs. Shopify's scrape**.

Two consequences:

**1. "We might lose" is not a reason to hold a case.** Losing a representment carries no
penalty — VDMP, and VAMP which replaced it, compute the dispute ratio from disputes
*received*, fixed the moment the chargeback lands. The outcome of the fight does not move
it. A case we hold because it looks weak is a case where we hand the issuer a worse document
for no benefit. (This is why the product-family auto-submit park was deleted on 2026-07-30 —
see `lib/automation/autoSubmitGuards.ts`.)

**2. The real question is honesty, not odds:** *would our letter assert something we cannot
back?* That question separates the guards cleanly, and it is the question this plan is
actually about:

| Guard | What our letter would say | Hold? |
|---|---|---|
| `weak` / `insufficient` | an honest argument from thin evidence | **No** — beats a raw scrape |
| `fatal_loss` (incl. proposed `cancelled_unfulfilled`) | contradicted by our own order record | **Yes** — on honesty grounds |
| `covered_shopify` | n/a — Shopify underwrites, no representment to win | Yes |

RC-2 is this same principle narrowed to one field: a citation may not outrun its exhibit.
The fix for an unbackable claim is to **stop making the claim**, never to stop filing.

---

## 3. Scope

### PR-1 — Citation/exhibit integrity (RC-1, RC-2, RC-3)

Ships together; #2 without #1 silently weakens every Gorgias pack, #1 without #2 makes
letters quieter rather than honest.

1. **Wire the attachment layer into `saveToShopifyJob`** behind
   `FILE_EVIDENCE_ATTACHMENTS_ENABLED`, per the existing
   `docs/plans/conditional_file_evidence_layer.plan.md` Phase 3 contract: run
   `decideFileAttachments`, generate per-entry PDFs, upload, persist GIDs for retry
   idempotency, set `*File` fields, suppress duplicated links in `uncategorizedText`.
2. **Fix RC-3** — read counts from `data.summary` (keep the top-level read as fallback
   for legacy facts).
3. **Citation-exhibit invariant** — a `customer_communication` fact may not carry
   `includeInBankNarrative: true` unless its exhibit will actually ship. Enforced in
   `lib/defence/__tests__/narrativeWriter.bankInclusionInvariant.test.ts` (existing
   home for exactly this class of assertion).
4. **Flag rollout** — dev first, verify a real submission carries two `fileGid`s, then
   prod. Prod enablement is a separate approval per CLAUDE.md #9.

**Fallback if the flag stays off:** invariant demotes `includeInBankNarrative` to
`false`, the letter stops citing uncorroborated correspondence. Honest either way — and
this is the correct shape under §2b: the remedy for a claim we cannot back is to drop the
claim, never to withhold the filing.

### PR-2 — Surface excluded/unreviewed Gorgias messages (RC-5)

- Repair the reasonless `needs_attention` write; ensure `GORGIAS_EVIDENCE_READY` fires
  when `review_status = 'candidate'` messages exist at build time.
- Add a distinct, higher-severity signal when an excluded message **contradicts** the
  thesis (e.g. `evidence_category ∈ BANK_EXCLUDED_EVIDENCE_CATEGORIES`, or merchant-sender
  cancellation/refund language) — the merchant must be told the strongest fact on file
  cuts against the case, even though it is correctly withheld from the bank.
- Bank-facing text is untouched. Merchant-UI only, per
  `[[feedback_bank_non_disclosure_two_layers]]`.

### PR-3 — Fatal-loss `cancelled_unfulfilled` trigger (RC-4)

- New `FatalLossReason: "cancelled_unfulfilled"` — `order.cancelledAt != null` AND
  `displayFulfillmentStatus === "UNFULFILLED"` AND `fulfillments.length === 0`,
  independent of reason code.
- Caps strength at `weak`, forces `heroVariant: "hard_to_win"`, blocks auto-save.
- Coverage still beats fatal-loss. New i18n token
  `disputes.strengthReason.fatalLoss.cancelled_unfulfilled` across all 6 locales in the
  same session, per `[[feedback_translate_on_add]]`.
- **The trigger must be argued on precision, not waved through as "safely strict."**
  This bullet previously read *"Gate only ever makes auto-mode stricter — false positives
  are missed auto-submits, never bad submissions."* Per §2b there is no such thing as a
  missed auto-submit: a false positive does not produce silence, it produces Shopify's raw
  order scrape landing at the issuer instead of our pack. Over-eagerness now has a real
  cost, so the "safe direction" argument no longer covers a loose trigger.

  The proposed trigger does still look tight — `cancelledAt != null` **AND**
  `displayFulfillmentStatus === "UNFULFILLED"` **AND** `fulfillments.length === 0` is hard
  to satisfy by accident, and an order matching all three genuinely cannot support an
  "authorized and delivered" thesis. But that is now a claim the PR must **demonstrate**
  (count the matching prod orders, confirm none have a defensible fulfilment story) rather
  than assume. The honesty justification is the load-bearing one: we hold these because our
  letter would contradict our own order record, not because we expect to lose.

---

## 4. Sequencing & risk

PR-3 is independent and cheapest to ship, since it stops the class of "argue a case our own
records contradict" without touching the submission path. It is **not** risk-free in the way
this section originally claimed: per §2b, blocking a case substitutes Shopify's scrape rather
than filing nothing, so a false positive is a real (if small) loss, not a no-op. Ship it
first for blast-radius reduction, but with the precision evidence §3/PR-3 now asks for.

PR-1 is the largest and carries real submission-path risk (it changes what is uploaded to
Shopify). PR-2 is independent of both.

Note that PR-1 is the one that most directly fixes the *actual* defect in the triggering
dispute. The letter's problem was not that the case was weak — it was that the letter cited
correspondence it never attached, on an order that had been cancelled and never shipped. §2b
argues we should file weak cases; it does not argue we should file dishonest ones.

**Blast radius:** blume-box has 90 active disputes with Gorgias live. Every pack citing
a Gorgias comm fact today ships an uncorroborated citation. Worth a read-only prod count
of affected open disputes before PR-1 lands.

**Not in scope:** re-submitting `29aca84c…` (due today 23:00 UTC, already saved to
Shopify); any change to the layer-two `BANK_EXCLUDED_EVIDENCE_CATEGORIES` block, which
behaved correctly.

## 5. Verification

- `npm test`, `npx tsc --noEmit`, `npm run build` (UI/route changes in PR-2).
- PR-1: dev submission producing ≥2 `fileGid`s in `shopify_response`; confirm the
  communication exhibit renders the approved excerpt, not the full body.
- PR-3: unit cases for cancelled+unfulfilled across INR and non-INR reasons; confirm
  coverage-beats-fatal-loss ordering holds.
- `docs/technical.md` updated in the same commit per `[[feedback_docs_update]]`.
