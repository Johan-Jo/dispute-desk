# Capture the bank's claim before answering reopened and "general" disputes

**Status:** PLAN, nothing implemented · **Date:** 2026-09-27 · **Related:** `mein-maison-status-and-no-return.plan.md` (Step 1 shipped as #861)

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
