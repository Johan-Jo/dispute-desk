# Capture the bank's claim before answering reopened and "general" disputes

**Status:** v1 SHIPPED to prod (#863→#883); follow-up work below IN PROGRESS · **Date:** 2026-09-27, status trued up 2026-09-28 · **Related:** `mein-maison-status-and-no-return.plan.md` (Step 1 shipped as #861)

## Status as of 2026-09-28 (audit)

What shipped, against the scope below:

| Plan item | State | Where |
|---|---|---|
| `needsBankClaim()` shared predicate | Done | `lib/disputes/bankClaim.ts` |
| Card: paste, upload, "Shopify shows no claim" | Done, **embedded app only** | `BankClaimCard.tsx` (#866, #868, #874) |
| Storage | Done, own table `dispute_bank_claims` (not `evidence_items`: pack rebuilds re-nest manual items) | #863, #868 |
| Claim as context, never cited | Done: system block + payload context | `narrativeWriter.ts` (#872) |
| Reason module picked from the claim | Done via `analyzeBankClaim` (Haiku) → `effectiveReasonForClaim` | #872 |
| Chosen family shown to merchant | Done: page follows the claim's type | #882 → prod #883 |
| Never auto-filed while unanswered | Done: save worker, deadline cron, approve route | `bankClaimBlocksFiling` |
| Facts the claim contradicts are removed | Done: `scopeFactsToBankClaim` | #872 |
| Nothing left to argue → no letter, merchant told what to add | Done | #875, #877, #880 |
| Merchant's own evidence not overwritten on reopen | **Not checked** | → F4 |
| Stale `needs_review` flag | **Not done** | → F5 |
| Copy in 6 locales + help article | Done | #863, #868 |
| Tests: claim never quoted verbatim | **Missing** | → F3 |
| Card on portal | **Missing** | → F6 |

## Follow-up (2026-09-28): what the audit found, and the fixes

**F1 — Policies and the order record never reach any letter.** `factClassifier` makes a fact bank-citable only when its *strength* is strong or moderate. A published refund/shipping policy is `supporting` unless the customer accepted it at checkout, and the order record is always `supporting`. So `bankIncludedFacts` drops them after the argument plan has included them. Prod, last 30 days: 242 letters; the plan included the refund policy in 133; **0** cite it; **0** cite the order record. On the Sura Svenne test (#1084, "not as described", return requested) this is why no letter could be written.
*Fix:* a citability rule separate from strength. Published policies (refund, shipping, cancellation) and the order record are **citable context**: they may be cited when the plan includes them, and they are still never scored (strength, completeness and the "safe argument" test are unchanged). Same mechanism as the existing carrier-shipment context. Reason modules that forbid policy (e.g. fraud) keep forbidding it: the plan decides relevance; this only stops the classifier from vetoing what the plan chose. Canary: three real letters rebuilt in memory before anything reaches prod.

**F2 — The argument plan and automation rules use Shopify's reason, not the claim's.** `buildDefencePackageJob` passes `dispute.reason` (GENERAL) to `derivePlanForCase` and `evaluateRules`, while the module, checklist and page use the claim's reason.
*Fix:* both receive `claimReason` (`effectiveReasonForClaim`).

**F3 — No test that the letter never quotes the claim.** *Fix:* a validator guard that fails a letter containing a long verbatim run of the claim text, plus the plan's truth-table / cycle tests where missing.

**F4 — Reopened disputes: merchant evidence.** `composeShopifyMutationPayload` sets only `uncategorizedFile` + customer fields; omitted fields are left as Shopify has them. *Fix:* verify on a live reopened dispute which fields hold merchant files, and record the result here; guard only if `uncategorizedFile` held a merchant file.

**F5 — Stale `needs_review`.** The dispatcher sets `needs_review = true` when the rule mode is review and never clears it when the mode is auto, so the deadline cron skips auto-pilot disputes. *Fix:* the dispatcher writes `needs_review = (mode === "review")`, plus a one-off re-evaluation of open disputes (dry run first, prod counts recorded here).

**F6 — Card on the portal.** *Fix:* render the same card on the portal dispute page.

**F7 — Counsel v2 writer is off whenever a claim exists** (`!bankClaim?.text`). Recorded, not changed here: counsel v2 does not take the claim as input yet.

Rollout: F1–F6 on develop; F1+F2 go to prod together after the canary letters are shown; the Sura Svenne "product not received" test (seed-bankclaim-test-3) is run end to end on prod afterwards.

## Problem

The bank's own explanation of a dispute (Shopify calls it the *issuer claim*, and after a loss the *issuer response*) is shown only in Shopify Admin, on the order's chargeback details. The Admin API has no field for it. For most reasons the reason code is enough to build a letter. For two cases it is not:

- **Reopened disputes.** Shopify moves an answered dispute back to `needs_response`, clears `evidence_sent_on`, and sometimes changes the reason. For example, #99142 went from `fraudulent` to `general`. The new round answers a claim we cannot see.
- **`general` disputes** with no network reason code. Shopify's own advice is to find out what the complaint is first. Our letter falls back to the generic module and shows "Unmapped chargeback claim".

For these, an automatic letter answers a question nobody asked. The merchant can read the claim; we need them to hand it to us.

## Scope (v1: manual capture)

**1. When we ask.** A dispute *needs the bank's claim* when it is open with a live deadline AND either:
   - `response_cycle ≥ 2` (reopened or escalated); or
   - its reason is `GENERAL` and it has no `network_reason_code`.

   This is one shared predicate, `needsBankClaim()`, in `lib/disputes/`.

**2. What the merchant does.** A card on the dispute detail page (embedded, portal and mobile), next to the other manual evidence:
   - The text says the bank's explanation is only visible in Shopify Admin, with a button that opens this dispute there (existing `getShopifyDisputeUrl`).
   - The merchant can paste the claim's text, upload the claim document (PDF/image, existing upload path), or both.
   - The merchant can also tick "Shopify shows no claim for this dispute". That is a valid answer: the bank doesn't always provide one.

**3. Storage.** A manual `evidence_items` row, `payload.kind: "bank_claim"`, with `{ text, fileId, noClaimShown, cycle, answeredAt }`. It is tied to the current response cycle: a reopen asks again. Route: `POST /api/packs/[packId]/bank-claim`, a copy of the parcel-outcome and cardholder-acknowledgement routes (window guard, audit, `checklist_v2` patch, `build_pack` enqueue).

**4. What changes downstream.**
   - **Letter writer.** The claim text is passed as *context the letter must answer*, never as a fact to cite, and never quoted back to the bank. The reason module is picked from the claim when the reason is `general`: a small keyword/LLM classifier into our existing families, with the chosen family shown to the merchant.
   - **Automation.** While `needsBankClaim()` is true and unanswered, the dispute is **never auto-filed**, including by the deadline cron. It shows as *Action required: add the bank's claim* in both automation modes. This is a real merchant task, so it is an attention reason, not a presentation flag.
   - **Nothing overwrites the merchant's own evidence.** Before any save on a reopened dispute, read the evidence already in Shopify (text fields and file IDs, e.g. #99142's round-one correspondence, service and shipping documentation). Keep the merchant's files unless we have a replacement of the same kind. Check what `composeShopifyMutationPayload` does to fields we don't set before building this.

**5. Copy.** All 6 locales, plus a help article: "Why DisputeDesk asks for the bank's claim".

## Also fix alongside (found 2026-09-27)

- **Stale `needs_review` flag.** 17 of Mein Maison's 19 open disputes carry it although the shop is on auto-pilot. The deadline cron excludes `needs_review`, while the page promises "saved to Shopify on {deadline}". The flag must follow the current rule mode, and the page and the cron must read the same predicate.

## Out of scope

- Reading the issuer claim automatically. Not possible through the API today; the Shopify support question below asks whether it can be.
- Pre-arbitration outside Shopify.

## Tests

- `needsBankClaim()` truth table: cycle 1 vs ≥ 2, `GENERAL` with and without a network code, closed or expired.
- The deadline cron and the save worker refuse a dispute that needs the claim and doesn't have it; both proceed once it is answered or marked "no claim shown".
- The claim text reaches the writer as context and never appears verbatim in the letter (guard test).
- A claim captured in cycle 1 does not satisfy cycle 2.

## Rollout

1. Build on develop and render #99142-shaped fixtures.
2. Promote to prod with per-change approval.
3. Mein Maison's open reopened disputes show the card. Tell them in the reply to their complaint.
