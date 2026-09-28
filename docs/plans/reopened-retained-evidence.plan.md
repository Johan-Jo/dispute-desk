# What Shopify already holds when we file: retained evidence on reopened disputes

**Status:** rev 3.1 (after three critic reviews; round 3 ACCEPT-WITH-RESERVATIONS, its fixes applied) · **Date:** 2026-09-28 · **Related:** `bank-claim-capture.plan.md` (F4), `mein-maison-status-and-no-return.plan.md`

## Problem

When a dispute reopens, Shopify keeps the previous response's text and files. It clears only the submission markers and its own summary (Shopify Developer Support, 2026-09-28, dispute 14551155022). Our save sends one PDF (`uncategorizedFile`) plus the customer's name and email, and never a text field (`composeShopifyMutationPayload.ts:37-56`, pinned by `saveToShopify.contract.test.ts`). **Whatever text is already there is filed again next to our letter.**

Holding does not help. If nothing is saved by the deadline, Shopify submits what the dispute holds (`project_shopify_files_anyway_reframes_guards`). The only way to keep a sentence away from the bank is to change the field.

## Measured 2026-09-28 (read-only, prod)

**All open `needs_response` disputes with a live deadline** (`scripts/shopify/scan-retained-evidence-text.mjs`): 31 across cay-collective (3), blume-box (4) and Mein Maison (24). 0 read errors.

| Content | Count | Where |
|---|---|---|
| Free text in `uncategorizedText` | 2 | both cycle 2: Mein Maison #99142, #94866 |
| Shopify's templated `accessActivityLog`, "Prior disputes on other orders: …" (helps us) | 3 | cycle 1: blume #348686, #352535; cycle 2: #99142 |
| Shopify's templated `accessActivityLog`, "Refunds on disputed transaction: A successful refund of €22.46 was issued…" (hurts us) | 1 | cycle 1: Mein Maison #99296 |
| Any other text field | 0 | |
| **Cycle-1 free text not written by Shopify** | **0** | |

**Cycle-2 detail** (`scripts/shopify/probe-reopened-evidence-text.mjs`; 7 open cycle-2 disputes, all Mein Maison. F4's "8" included #13638, which has since closed):

| Order | State | Retained free text | File in slot |
|---|---|---|---|
| #99142 (due 10-01) | needs_response, GENERAL (was FRAUDULENT) | "The purchase was made by the rightful cardholder" (fraud-framed; off-target now) | AdditionalEvidence.pdf |
| #94866 (due 10-02) | needs_response, PRODUCT_UNACCEPTABLE | "The customer has returned the item, but it has not yet arrived… The chargeback is therefore premature and invalid until the returned item is received" (an admission for a not-as-described case) | AdditionalEvidence.pdf |
| #99348 (due 10-05) | needs_response | none | none |
| #93953, #95439, #90906, #95311 | under_review, merchant filed round 2 themselves | refusal and return-first text. #90906 adds a China return address, a pasted timeline and "offered a 50% refund" | merchant files |

### What we cannot know

- **Who wrote a free-text field.** The API has no author. Two disputes carry the same text word for word, which points to a tool or template. Shopify's own `accessActivityLog` lines are recognisable by their fixed headings.
- **Whether `""` or `null` clears a field**, and whether Shopify returns a `userError` for blank.
- **Whether an unchanged field is re-submitted** with `submitEvidence: true`, or only what changed.
- **What PayPal receives.** About 98% of Mein Maison's disputes are PayPal wallet. We don't know whether Shopify forwards these fields verbatim, compiles them into one document, or drops them.
- **Whether the merchant can edit the retained text in Shopify Admin** on a reopened PayPal dispute. Unverified. We do not ask them to until it is.

## Principle

Our filing is everything Shopify sends, not just our PDF. Round-1 content was **already sent** to the issuer in round 1. Clearing it removes it only from this round's packet, and our records keep a copy. On a reopened dispute we therefore act as counsel by default:

- We clear free text that was on the dispute when it reopened, and keep anything written after the reopen.
- We never embed unreviewed content in our own PDF.
- We never add a gate that blocks filing.
- The merchant can override.

This plan adds no wait of its own. The bank-claim card still holds every cycle-2+ dispute until the merchant answers it (`bankClaim.ts:46`, cron check `route.ts:295-307`). That hold is separate and unchanged here, and it is why §3b exists.

## Scope

**1. Snapshots, for the UI and baselines.** The hourly sync already reads `disputeEvidence` (`lib/shopify/queries/disputes.ts:27-42`).
- Do **not** add the text fields to `DISPUTE_LIST_QUERY`. It has no status filter (`queries/disputes.ts:13-14`), and `redactPII` (`syncDisputes.ts:106-118`) copies the whole node into `disputes.raw_snapshot`, so the text would reach every dispute's raw snapshot.
- Instead, after the page loop, run a separate per-dispute `readEvidenceRecord` for open disputes only. Measure the cost on Mein Maison (24 open).
- Write a row to `shopify_evidence_snapshots` whenever any field changes: `dispute_id`, `cycle`, raw fields, one hash per `ClearableTextField` (normalised, sentinel stripped), and `read_at`.
- **The first snapshot of a cycle is its baseline.** When the reopen is detected, the reopen branch of `applyDisputeSnapshot` enqueues a `snapshot_evidence` job. This matters most when the webhook detects the reopen, because the webhook payload carries no evidence text (`handleDisputeWebhook.ts:172-187`). The baseline therefore lands within minutes, not at the next sync.
  - **Remaining window:** text written between the reopen and that job counts as baseline. That window is minutes long and accepted.
- PII: add the table to `scrubCustomerData.ts`, the shop-redact route, `customers-data-request` (GDPR export) and `retention-cleanup`.
- Snapshots never gate a save (§3).

**2. What v1 acts on.** Only the three free-text fields: `uncategorizedText`, `refundRefusalExplanation` and `cancellationRebuttal`. This set is the `ClearableTextField` type union, and nothing outside it can be cleared.
- **Shown but never changed:**
  - `refundPolicyDisclosure` and `cancellationPolicyDisclosure`: these are the store's policy, not round-1 argument. Whether to cite or bury a policy is a per-case call, and the measured count is 0.
  - `accessActivityLog`: this is Shopify's record (D3).
  - Files in other slots.
- **Out of scope:** `productDescription` (not writable, `disputeEvidenceUpdate.ts:16`) and the customer fields.
- `DISPUTEDESK_CLEAR_SENTINEL`, exported next to `isDisputeDeskFile`, never counts as retained content.

**3. Default on cycle 2+: clear the baseline, decided from a live read.**
- **(a) In the save.** At Guard B (step 7b), just before the mutation, the worker reads the live record. That read decides, not the snapshot.
  - A `ClearableTextField` whose live value hashes to the cycle's baseline is cleared, unless a `keep` override exists for that field hash.
  - A value that differs from the baseline was written after the reopen. It is kept and shown.
  - No baseline yet: the live value is the baseline.
  - The save never refuses on any of this.
- **(b) Clear-only write, independent of the other gates.**
  - **When:** the sync sees baseline free text on a cycle-2+ dispute and the pack is not fileable. That means any of: its status is not `ready`/`saving`; `bankClaimBlocksFiling()` is true (the same check the cron uses, `route.ts:296`; not `needsBankClaim()`, which is true for every cycle-2+ dispute); or the last save in this cycle was refused by F4 (a `save_to_shopify_refused_merchant_file_present` audit). A fileable pack is left to (a), so in review mode the approve click can still offer "Keep it instead" before anything is cleared.
  - **What:** a `clear_retained_text` job, not an inline write in the sync loop. The job sends one `disputeEvidenceUpdate` with only the fields to clear and `submitEvidence: false`, audits `retained_text_cleared`, and runs at most once per field hash.
  - **Why:** it keeps the round-1 text out of what Shopify files at the deadline, even if our letter never goes. This is the only part of the plan that helps #99142 and #94866 before the file question is settled (D5).
  - **Must be proven first:**
    - that the write has no side effect on Shopify's `status` or `evidenceSentOn`;
    - that it does not trip `opensNewResponseCycle` or change our `submission_state`. The write goes through a separate code path from `saveToShopifyJob` and never touches pack or submission state.
  - **Race with a `keep` override:** there is no advisory lock in the codebase, and one taken through PostgREST could not span the Shopify call anyway. Serialise instead: the 3b clear and the keep write-back are both jobs on the same single-flight key (`dispute_id`) through `claim_jobs`. The clear job re-checks for an override before writing. A `keep` recorded after a clear writes the value back from the snapshot (`submitEvidence: false`).
- **How a field is cleared:**
  - If the dev-store test shows `""` (or `null`) clears it, send that.
  - Otherwise, (a) writes the sentinel "Please see the enclosed response document." into `uncategorizedText` only, because a document is enclosed. (b) writes nothing, because none is. In that case the field is left and shown.
  - The type union is fixed; the runtime clear set follows the test result.

**4. Cycle 1: observe only.** We measured 0 cycle-1 disputes with free text not written by Shopify. Write snapshots and a `retained_text_detected` audit, and change nothing. Revisit if that count stops being 0.

**5. Merchant override, never a precondition.**
- **How the merchant sees it:**
  - *Review mode:* the approve click says "Approving also removes the text below, which was sent in the previous round. [Keep it instead]".
  - *Auto mode and path 3b:* we act first, then email what was removed and where to see it.
  - The dispute page shows removed text as "Sent in the previous round, not re-sent", with the reason code at the time.
- **Storage:** `retained_text_overrides` (`dispute_id`, `cycle`, `field`, `field_hash`, `decision='keep'`, `decided_by_user_id`, `surface`, `decided_at`), per field hash, with history kept. It is separate from F4's `merchant_file_approvals`.
- **Route:** embedded and portal auth. It re-enqueues the save. It resets a `blocked` pack to `ready` only when the block's reason is one the override resolves. An F4 block stays blocked, so there is no blocked → ready → blocked loop with a fresh alert each time.

**6. Files.** F4's decision stands: the merchant's file is not replaced without their approval. The annex never merges a merchant file without a per-case check that it helps; #90906's file ("offered a 50% refund") shows why. See D4.

**7. Save worker and contracts.**
- `readEvidenceRecord` replaces `readUncategorizedFile`, and the F4 guard is adapted to it.
- `composeShopifyMutationPayload` gains `clearFields: ClearableTextField[]`. Its "no text fields" contract (`:13-16`, `saveToShopify.contract.test.ts`) is amended to "no text fields except `clearFields`, each empty or the sentinel".
- `diffVerificationReadback` treats a cleared key as confirmed iff the readback is empty or the sentinel.
- **Refusals become visible:**
  - A non-retriable refusal (F4's today) sets the pack to the existing `blocked` status (`lib/types/packStatus.ts:28`, set by nothing today), not `saving`. It also stores a `blocked_reason`, and the page uses reason-aware copy, because `normalizeStatus.ts:103-110` would otherwise say "Evidence pack has blockers".
  - It raises an attention reason; `bank_claim_needed` takes precedence.
  - It calls the no-file admin alert, moved from the cron closure (`route.ts:210`) into `lib/`.
  - `blocked` becomes re-enterable at the three gates: `saveToShopifyJob.ts:77`, `lib/defence/enqueue.ts:83` and `app/api/packs/[packId]/approve/route.ts:62`.
  - This also fixes F4's existing stuck-in-`saving` bug.
- Fix the false comment at `disputeEvidenceUpdate.ts:21`: the IP is not appended to `accessActivityLog`.

**8. Our letter never sees snapshot content.** It is never passed to the writer.

## Decisions for the user

### Decided 2026-09-28 (user)

- **D1: yes.** Clear baseline free text on cycle ≥ 2 by default, with an override.
- **D2: nothing is erased until the user has seen it firsthand.** No clear-only write, operator script or save that clears text runs on #99142 or #94866 until the user has looked at the evidence in Shopify Admin and said go:
  - #99142: https://admin.shopify.com/store/6a8848-dd/payments/dispute_evidences/14550761806
  - #94866: https://admin.shopify.com/store/6a8848-dd/payments/dispute_evidences/14349173070
- **D3: leave untouched for now.** `accessActivityLog` is never changed in v1.
- **D4: yes, read the files first.** Attempted 2026-09-28: `uncategorizedFile.url` returns an encrypted JSON envelope (`{"encrypted_key": …}`), not the PDF. **Round-1 files cannot be read through the API.** Only a person viewing Shopify Admin can say what they are, so this folds into D2.
- **D5: open.** Re-explained in plain terms; waiting for an answer.

Original options, kept for the record:

- **D1. Default on cycle 2+:** clear baseline free text, with an override (§3, §5). *Recommended.* Keeping by default would file text like #94866's admission next to our letter. The case for keeping ("don't delete their words") is already met by the snapshot, the page and the override.
- **D2. Mein Maison now** (#99142 due 10-01, #94866 due 10-02).
  - *Recommendation:* in the reply we owe them, name both sentences, say they were sent in round 1, and say we will remove them from this round unless they object. Ask about the round-1 file there too (D4).
  - Run the dev-store test now. If a clear-only write works, run path 3b for the two as a one-off operator script, `scripts/shopify/clear-retained-text.mjs`:
    1. Dry run first.
    2. #99142 first, read it back, then #94866.
    3. This needs your per-change approval, because it writes to a merchant's live dispute.
  - If they object or nobody approves, record that Shopify filed its record.
- **D3. Shopify's own activity-log lines.** "Prior disputes… resolved for the merchant" helps us. "A successful refund of €22.46 was issued" hurts us, and Shopify wrote it (#99296). *Recommendation:* leave the field untouched in v1 and show it to the merchant. Whether we ever remove a Shopify-authored line is a separate decision.
- **D4. The round-1 file** (#99142, #94866: `AdditionalEvidence.pdf`). F4 decided approval is required. *Recommendation:* keep that rule, but first download and read the two files (read-only).
  - If a file is Shopify's own auto-compiled order summary rather than the merchant's work, treat it as round-1 content like the text and replace it by default.
  - Otherwise, ask the merchant in the D2 reply.
  - Until then these two cannot carry our letter; only 3b protects them.
- **D5. The clear-only write (§3b)** changes a merchant's Shopify evidence without filing and without asking first. *Recommendation:* yes, on cycle-2+ baseline free text only, with email and override. It is the only path that stops Shopify re-filing the round-1 admission when we can't file.

## Rollout

1. ✅ Read-only measurement (above).
2. Dev-store write test on a test dispute. Record the results here:
   - Set text, then `""`, then `null`, reading back each time.
   - A `submitEvidence: false` clear-only write persists, and leaves `status` and `evidenceSentOn` unchanged.
   - Shopify's deadline auto-file uses the record as it stands.
   - Whether an unchanged field is re-submitted.
3. Read the two round-1 files (D4), read-only.
4. Sync snapshot and observe-only audit (§1, §4) on develop, then prod with approval. No behaviour change.
5. The rest, develop first, rendered on #94866-shaped fixtures, then prod with per-change approval:
   - the clear-only path (§3b);
   - save-worker clearing, the verifier and visible refusals (§3, §7);
   - the override and the card (§5).

## Tests

- **Baseline:** it is the first snapshot of the cycle, and the reopen path writes it. Live value equal to the baseline is cleared; a different live value is kept.
- **Missing or stale snapshot:** the live read decides. A save is never refused because of retained text.
- **Overrides:**
  - A `keep` on a field hash means that field is not cleared.
  - A regenerated `accessActivityLog` or a file change does not touch overrides, because the hashes cover the clearable fields only.
- **Clear-only write (3b):**
  - Fires once per field hash, only on cycle 2+, and only when the pack is not fileable (the §3b definition).
  - Never writes the sentinel.
  - Never changes pack status or `submission_state`, never stamps `evidence_saved_to_shopify_at` or `submitted_at` (these drive `responseAnchorKey`), and does not open a new cycle (`responseCycle.ts:83`).
  - Fires only when `bankClaimBlocksFiling()` or F4 holds the dispute, or it isn't `ready`. A `ready`, answered pack is left to (a).
  - Serialised with the override through the single-flight job key.
- **Payload:** only `ClearableTextField` keys are cleared. Policy fields, `accessActivityLog`, `productDescription` and the customer fields never are (type test).
- **Verifier:** a cleared key is confirmed. A non-empty readback of a cleared key means unverified.
- **Refusals:** a non-retriable refusal sets the pack to `blocked` with a reason, raises attention and sends the admin alert. The override route resets to `ready` only for a reason it resolves; an F4 block stays blocked.
- **PII:** `raw_snapshot` never contains evidence text fields.
- **Letter:** the writer never receives snapshot content.
- **Parser:** the "Prior disputes…" and "Refunds on disputed transaction…" blocks are recognised.
- **Copy:** 6 locales, plus a help article, "What DisputeDesk does with evidence already in Shopify", which says round-1 content was already sent.
