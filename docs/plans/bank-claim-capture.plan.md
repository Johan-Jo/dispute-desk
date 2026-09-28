# Capture the bank's claim before answering reopened and "general" disputes

**Status:** v1 SHIPPED to prod (#863→#883); follow-up F1–F3, F5, F6 on develop; F4 decision open · **Date:** 2026-09-27, status trued up 2026-09-28 · **Related:** `mein-maison-status-and-no-return.plan.md` (Step 1 shipped as #861)

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
*Fix (DONE, PR below):* `isCitableRecordContext` — the published refund and shipping policies and the order record are citable context, still never scored. Context alone is never an argument (`hasArgumentBeyondRecordContext`): a case left with only those is still skipped, so this is NOT "always write a letter". `cancellation_policy` stays out: policySource fills it from the terms of service.
*What the canary found and the fix now includes:* the first canary letters said "neither policy was recorded as accepted at checkout" (the fact carried `acceptedAtCheckout: false`) and one invented terms ("a refund is contingent on the return of goods"). So a policy fact now carries `{ publishedOnStore, publishedUrl }` and acceptance only when true; base prompt rule 8d plus four unconditional validator bans (`policy_acceptance_disclaimed`, `policy_terms_beyond_record`, `policy_timing_beyond_record`, `record_absence_narrated`). The PDF thesis clause no longer says policies were "available to the customer at checkout".
*Canary (`scripts/defence/canary-record-context.mts`, read-only, 2026-09-28):* 7 prod disputes, one per module (#93254 NAD, #15979 credit-not-processed, #351820 fraud, #99348 recurring, #353605 general, #100537 INR) + test #1060. All 7 pass with the job's one feedback retry (4 retried; 2 of those on the new record-absence ban catching an older habit). Policy paragraphs read only "published on the store at <link>".

**F2 — The argument plan and automation rules use Shopify's reason, not the claim's.** `buildDefencePackageJob` passed `dispute.reason` (GENERAL) to `derivePlanForCase` and `evaluateRules`, while the module, checklist and page use the claim's reason.
*Found while fixing it — a filing blocker:* the filing-time plan check (`derivePlanIdentityForPack`) resolved the module from Shopify's reason while the build used the claim's. The module's allowed categories feed `plan_input_hash`, so every claim-typed letter read stale and could not be filed. Verified on prod: test #1060's stored hash ≠ the filing check's. No real merchant hit it yet (only the two test disputes have a claim).
*Fix (DONE, same PR):* `resolveCaseReasonCodeModule` is the one resolver for the build and the filing check; the filing check reads `pack_json.case_assessment_reason`. Plan and rules get the claim's reason.

**F3 — No test that the letter never quotes the claim.** *Fix (DONE):* `bank_claim_quoted` in `validateNarrative` fails a section sharing 8 consecutive words with the claim. The plan's other listed tests already existed (`bankClaim.test.ts` truth table + current-cycle read; deadline cron P6 and save-worker window guards refuse without the claim).

**F4 — Reopened disputes: merchant evidence.** `composeShopifyMutationPayload` sets only `uncategorizedFile` + customer fields; omitted fields are left as Shopify has them (API update semantics, not tested live: testing would mean a write).
*Measured 2026-09-28 (read-only, `scripts/shopify/probe-reopened-evidence.mjs` + `probe-evidence-file-names.mjs`):* 8 open reopened disputes. On 6 the uncategorized slot holds the **merchant's own round-one file** ("AdditionalEvidence.pdf", "Mein Maison · Orders · #90906 · Additional_Evidence 2.pdf"; ours is named `Defence-<id>-…pdf`), and DisputeDesk has no record of saving round one. Customer-communication, service and shipping files sit in other slots and are not touched.
**Our cycle-2 save would replace that merchant file.** *Decision (user, 2026-09-28):* never replace it until the merchant approves; prepare the annex but do not run it. *Done:* save-worker guard `guardMerchantFileSlot` refuses any save over a non-DisputeDesk file (fails closed if unreadable). The annex (`appendMerchantFile`, pdf-lib) runs only with `MERCHANT_FILE_ANNEX_ENABLED=on` AND a `merchant_file_approvals` row for the dispute+cycle — neither exists. *Next:* get the merchant's approval (Mein Maison: #99142, #94866 + the other reopened ones), record it, then decide on switching the annex on.

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
