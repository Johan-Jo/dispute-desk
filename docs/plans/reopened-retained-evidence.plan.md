# What Shopify already holds when we file: retained evidence on reopened disputes

**Status:** rev 4.1 (restrictions: no out-of-app merchant contact; files unreadable; critic fixes applied) · **Date:** 2026-09-28 · **Related:** `bank-claim-capture.plan.md` (F4), `mein-maison-status-and-no-return.plan.md`

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
- **The contents of any dispute file.** `…File.url` is a signed Google Cloud Storage link that returns `200 application/pdf`, but the body is an envelope: `{"encrypted_key","encrypted_iv","data"}`. The key and IV are RSA-2048-wrapped, and the data is AES-encrypted. **Our own `Defence-…pdf` uploads come back the same way** (three checked on blume-box). This is Shopify's at-rest encryption; the key is Shopify's, and no key of ours opens it. REST gives file ids only, and `dispute_file_uploads/{id}.json` is 404. We can read a file's name, type and size, never what it says.

## Constraints (user, 2026-09-28)

- **Everything has to work at scale, without anyone contacting a merchant outside the app.** No emails asking for PDFs, no store access, no manual collection. The merchant may *review and decide inside DisputeDesk*, on our dispute page, with the existing "Open in Shopify Admin" link to look at their own evidence. That is the only human step, and it is optional: every path must also finish when the merchant does nothing.
- A file is judged only by where it came from (its name), never by what it says, because nobody at DisputeDesk can read it.

## Principle

Our filing is everything Shopify sends, not just our PDF. Round-1 content was **already sent** to the issuer in round 1, so leaving it out of round 2 removes nothing from the record. On a reopened dispute, we act as counsel by default:

- We clear free text that was on the dispute when it reopened, and keep anything written after the reopen.
- We never merge anything into our own PDF that we cannot read.
- We never add a gate that blocks filing.
- The merchant can change any default in the app, and nothing waits for them to.

## Scope

**1. Snapshots, for the page and for baselines.**
- **How we read.** We run a separate per-dispute `readEvidenceRecord` for open disputes only: the six text fields plus, for each of the six file slots, the upload's `id`, name, type and size. It is not added to `DISPUTE_LIST_QUERY`, for two reasons: that query has no status filter, and `redactPII` (`syncDisputes.ts:106-118`) would copy the text into `disputes.raw_snapshot`. Measure the cost on Mein Maison first (24 open).
- **What we store.** A row in `shopify_evidence_snapshots` whenever anything changes: `dispute_id`, `cycle`, the raw text fields, the file-slot metadata (upload ids), one hash per clearable field, and `read_at`. The baseline records which upload ids were present at the reopen.
- **The baseline.** The first snapshot of a cycle is its baseline. The reopen branch of `applyDisputeSnapshot` enqueues a `snapshot_evidence` job, so the baseline lands within minutes, even when the reopen arrives by webhook (webhook payloads carry no evidence text; see `handleDisputeWebhook.ts:172-187`). Text written in those minutes counts as baseline; we accept that.
- **PII.** The table is added to `scrubCustomerData.ts`, the shop-redact route, `customers-data-request` and `retention-cleanup`.
- Snapshots never gate a save.

**2. Text: what v1 acts on.** Three free-text fields: `uncategorizedText`, `refundRefusalExplanation` and `cancellationRebuttal`. They form the `ClearableTextField` type union, and nothing else can be cleared.
- **Shown on the page, never changed:** the two policy-disclosure fields (the store's policy, not a round-1 argument; measured count 0), `accessActivityLog` (Shopify's own record, D3), `productDescription` (not writable) and the customer fields.
- `DISPUTEDESK_CLEAR_SENTINEL` never counts as retained content.

**3. Text default on cycle ≥ 2: clear the baseline, decided from a live read.**
- **(a) In the save.** At Guard B (step 7b), right before the mutation, the worker reads the live record, and that read decides.
  - A clearable field whose value hashes to the baseline is cleared, unless the merchant chose "Keep" for that field hash.
  - A value that differs from the baseline was written after the reopen, so it is kept.
  - With no baseline yet, the live value is treated as the baseline.
  - The save never refuses over any of this.
- **(b) When we cannot file, clear anyway (D5).**
  - **When it applies:** the pack is not fileable, meaning any of:
    - its status is not `ready` or `saving`;
    - `bankClaimBlocksFiling()` is true;
    - the file rule in §4 holds it.
  - **What it does:** a `clear_retained_text` job sends only the fields to clear, with `submitEvidence: false`, once per field hash, audited as `retained_text_cleared`. This keeps round-1 text out of what Shopify files at the deadline even when our letter can't go.
  - **Preconditions** (dev-store test first):
    - it must not change Shopify's `status` or `evidenceSentOn`;
    - it must not open a new cycle;
    - it must not stamp `evidence_saved_to_shopify_at`/`submitted_at` or change `submission_state`.
  - **Race with "Keep":** the clear and a "Keep" write-back share one single-flight job key (`dispute_id`, via `claim_jobs`). The clear re-checks for a "Keep" before writing. A "Keep" chosen after a clear writes the value back from the snapshot.
  - A fileable pack is left to (a), so in review mode the merchant sees "Keep it instead" before anything is cleared.
- **How a field is cleared.** If the dev-store test shows `""` (or `null`) clears it, we send that. Otherwise:
  - (a) writes the sentinel "Please see the enclosed response document." into `uncategorizedText` only;
  - (b) writes nothing, because no document is enclosed. The round-1 text then still goes out at the deadline. This is an accepted leftover until the test result is in.

**4. Files: judged by origin and baseline, and we always file.** Our PDF normally goes into `uncategorizedFile`. What happens depends on what is already there:

| What `uncategorizedFile` holds | Default | "Keep it" (in the app, before filing) |
|---|---|---|
| Nothing, or our own file (`isDisputeDeskFile`) | Our letter goes there, as today | — |
| A file that is not ours, **in the cycle's baseline** (so it was sent in round 1) | **Replace it with our letter** (D6) | Their file stays; our letter goes into an empty slot |
| A file that is not ours, **not in the baseline** (added this round, or on cycle 1) | Their file stays; **our letter goes into an empty slot** | — (their file is already kept) |

- **The empty slot.** We use the first empty one of Shopify's six file slots (`disputeEvidenceUpdate.ts:63-68`), in a fixed order: `serviceDocumentationFile`, then `customerCommunicationFile`, then `shippingDocumentationFile`. The two policy slots are never used.
  - If no slot is free, the baseline rule applies. A round-1 file is replaced. A current-round file is kept and we do not file. That is the only no-file case, and it is alerted like every other.
  - Rollout step 2 checks that a PDF in a second slot reaches the issuer.
- **So a silent merchant never ends up without a letter because of a file.** "Keep" never means "don't file".
- **The other five slots** keep what they hold and are listed on the page. Round-1 files in those slots are still re-sent. This is an accepted leftover unless Rollout step 2 shows a slot can be cleared.
- **Choices** are stored in `retained_evidence_choices`: `dispute_id`, `cycle`, `item` (a field name or file slot), `item_hash` (the text hash, or the upload `id`), `choice` (`keep` | `replace`), `decided_by_user_id`, `surface`, `decided_at`. History is kept, and a changed item gets the default again.
- **Slot read failure.** Up to 3 retries. Then we file our letter into `uncategorizedFile` only if that slot was empty or ours at the last successful read; otherwise we use the empty-slot rule. The only risk left is a mislabelled slot, and nothing is withheld.
- **The F4 annex is removed.** It downloads the merchant's file first, and that download only ever returns the encrypted envelope.
  - A new migration drops `merchant_file_approvals` (no rows); the create file stays in history. Apply it to dev and prod.
  - Delete `merchantFileAnnex.ts` and `MERCHANT_FILE_ANNEX_ENABLED`.
  - Rewrite `merchantFileGuard.ts` and its test as the §4 table.
  - Update `docs/technical.md:941`.
  - Keep `save_to_shopify_refused_merchant_file_present` in the `logEvent.ts` union, because historical rows use it.

**5. Merchant review, inside the app only.**
- An "Already in Shopify" card on the dispute page (embedded, portal, mobile) lists the retained text and files and what will happen to each, with the "Open in Shopify Admin" link.
- **The card is interactive only while the dispute is unfiled:** in review mode, where it rides the approve click, or while only §3b has acted. Each item offers "Keep" or "Replace". The choice route re-enqueues the save. A "Keep" after a §3b clear writes the text back.
- **Once we have filed** (`submitEvidence: true`), the card becomes a read-only record: "Replaced", "Sent in the previous round, not re-sent" (with the reason code at the time), or "Kept". It offers no control, because submitted evidence can't be changed.
- In auto mode, an email tells the merchant where to see the record. It informs; it doesn't ask.

**6. Save worker and contracts.**
- `readEvidenceRecord` replaces `readUncategorizedFile`.
- `composeShopifyMutationPayload` gains `clearFields: ClearableTextField[]`. The "no text fields" contract (`:13-16`, `saveToShopify.contract.test.ts`) is amended to "no text fields except `clearFields`, each empty or the sentinel".
- `diffVerificationReadback` confirms a cleared key iff the readback is empty or the sentinel. For our file it confirms by slot name and size only, since contents can't be read back.
- **A non-retriable refusal:**
  - sets the pack to `blocked` (`lib/types/packStatus.ts:28`, which nothing sets today) with a `blocked_reason` and reason-aware copy;
  - raises an attention reason and calls the no-file admin alert, moved from the cron closure (`route.ts:210`) into `lib/`.
  - `blocked` is made re-enterable at `saveToShopifyJob.ts:77`, `lib/defence/enqueue.ts:83` and `app/api/packs/[packId]/approve/route.ts:62`.
  - The choice route resets to `ready` only for a reason the choice resolves.
- Fix the false comment at `disputeEvidenceUpdate.ts:21`.

**7. Our letter never sees snapshot content.** It is never passed to the writer.

**8. Cycle 1: text observed only.** We measured 0 cases of free text not written by Shopify. We write a `retained_text_detected` audit and change no text. Files on cycle 1 follow the §4 table: never replaced, and our letter goes into an empty slot.

## Decisions

- **D1 — yes (user).** Clear baseline free text on cycle ≥ 2 by default.
- **D3 — untouched for now (user).** `accessActivityLog` is never changed in v1.
- **D2 — Mein Maison #99142 / #94866 (user: nothing erased before you have seen it).** You have seen the text:
  - #99142: "The purchase was made by the rightful cardholder"
  - #94866: "The customer has returned the item, but it has not yet arrived at our warehouse for inspection. The chargeback is therefore premature and invalid until the returned item is received and inspected by the merchant."

  - The files can't be seen by anyone at DisputeDesk, so they follow the §4 rule like every other dispute.
  - **Timing.** #99142 is due 10-01 and #94866 10-02. §3–§4 can't ship by then.
  - **Canary path.** A one-off §3b clear-only script (text only), run once the dev-store test shows a clear works. It runs on #99142 first, reads back, then #94866, each after your go.
  - If the test or your go misses a date, that dispute goes out as Shopify holds it, and this is recorded here.
- **D4 — superseded.** "Read the files first" is impossible (see above). Files are judged by origin (§4).
- **D5 — open. When we can't file, may we still remove the old text?** Plain version: on #94866 our letter is held (the bank's claim is missing and a round-1 file sits in the slot). If we do nothing, Shopify sends the round-1 text to the bank at the deadline. With D5, we remove only that text, without filing, and show it on the page. *Recommendation: yes.*
- **D6 — open. Should a round-1 file (one in the baseline) on a reopened dispute be replaced with our letter by default?**
  - This reverses F4's "never without the merchant's approval". Approval is still possible in the app, but it can no longer be required, because a silent merchant would otherwise always get the round-1 package re-sent.
  - A file added this round is never replaced; our letter goes into another slot.
  - *Recommendation: yes.*
- **D7 — open, and it blocks the file work. The bank-claim hold waits on the merchant.**
  - `needsBankClaim()` is true for every reopened dispute, and the save worker refuses until the claim is pasted (`saveToShopifyJob.ts:178-198`).
  - So for a merchant who does nothing, §3a and §4 never run; only §3b does. That breaks constraint (1).
  - *Recommendation:* make the claim optional input. Without it, we file a claim-neutral letter at deadline minus 2 days, based on the current reason code, as the letter did before the card existed. The card stays, and a claim pasted before then still shapes the letter.
  - Until D7 is decided, §4 reaches only merchants who paste the claim.

## Shopify question

The follow-up to Developer Support (the Hanad thread) asks whether an app can download a readable copy of a dispute file upload. If it can, §4 can judge files by content and verification can read back our own PDF. Until then, the plan does not depend on it.

## Rollout

1. ✅ Read-only measurement (above).
2. Dev-store write test on a test dispute. Record the results here:
   - Set text, then `""`, then `null`, reading back each time.
   - Check that a `submitEvidence: false` write persists and leaves `status` and `evidenceSentOn` unchanged.
   - Check whether the deadline auto-file uses the record as it stands.
   - Check whether an unchanged field is re-submitted.
   - Check whether replacing `uncategorizedFile` detaches the old upload.
   - Check that a PDF uploaded to `serviceDocumentationFile` (a second slot) is submitted, and how it is labelled.
   - Check whether a file slot can be cleared.
   - Check that a retained upload keeps its `id` across a reopen.
3. Sync snapshot + observe-only audit (§1, §8) on develop, then prod with approval. No behaviour change.
4. Clear-only (§3b), save-worker clearing, the file rule (§4), removing the annex, visible refusals (§6), and the card (§5). Develop first, rendered on #94866-shaped fixtures. Prod with per-change approval, then the D2 canary.

## Tests

- **Baseline.** A live value equal to the baseline is cleared; a changed value is kept. With no snapshot, the live read decides, and a save is never refused because of retained content.
- **Choices.**
  - "Keep" on an item hash protects that item.
  - A changed item gets the default again.
  - A regenerated `accessActivityLog` doesn't disturb choices.
- **Clear-only (3b).**
  - Fires once per hash, only on cycle ≥ 2, and only when the pack isn't fileable.
  - Never writes the sentinel, never stamps `evidence_saved_to_shopify_at`/`submitted_at`, and never opens a cycle.
  - Serialised with "Keep".
- **Files** (the §4 table, row by row):
  - A foreign file in the baseline is replaced; with "Keep", our letter goes into the empty slot.
  - A foreign file not in the baseline, or on cycle 1, is never replaced; our letter goes into the empty slot.
  - With no free slot, the rule in §4 applies.
  - A slot read failure files after 3 retries.
  - No code path downloads a file's contents.
- **Card.** Interactive only while unfiled; read-only after `submitEvidence: true`.
- **Payload.** Only `ClearableTextField` keys are cleared; the other fields never are (type test).
- **Verifier.** Cleared keys are confirmed; our file is confirmed by name and size.
- **Refusals.** A refusal sets `blocked` with a reason, raises attention and sends the alert.
- **PII and the letter.** `raw_snapshot` never contains evidence text, and the writer never receives snapshot content.
- **Copy.** 6 locales, plus the help article "What DisputeDesk does with evidence already in Shopify".
