# What Shopify already holds when we file: retained evidence on reopened disputes

**Status:** rev 5 (external review adopted: D5 conditional, D6 narrowed, D7 yes; live clearing not yet approved) · **Date:** 2026-09-28 · **Related:** `bank-claim-capture.plan.md` (F4), `mein-maison-status-and-no-return.plan.md`

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

- **It has to work at scale, with no contact with the merchant outside the app.** No asking a merchant for PDFs or store access, and nothing collected by hand. The merchant may review and decide *inside DisputeDesk*, on our dispute page, with the existing "Open in Shopify Admin" link. That step is always optional, and every path must finish when the merchant does nothing.
- **A file's contents are never known to us.** We see its upload `id`, name, type and size, and nothing else.

## Review adopted (2026-09-28, pasted by the user)

- Approved now: the test-store checks and observe-only snapshots.
- **Not approved yet:** live clearing and replacement.
- **D7:** yes. **D5:** yes only if the test passes, with a defined trigger, verification and merchant view. **D6 as written:** no. It is narrowed in §4.
- Wording: that round-1 content already reached the issuer is a **working judgment**. It is a reason not to repeat that content, not proof that removing it has no effect on the reopened review.

## Principle

What we file is everything Shopify sends, not only our PDF. Our working judgment is that repeating round-1 statements in round 2 does not help the merchant and can hurt them, as #94866 shows. So:

- **Text:** we clear it only when we can prove it is round-1 content. When we can't prove that, we keep it, still file our letter, and alert.
- **Files:** we never remove or replace a file we didn't upload. Our letter goes beside it.
- **Filing:** we never add a gate that blocks filing. The one case where we can't file (§4, no free slot) is named and alerted.
- **The merchant:** can change any default in the app. Nothing waits for them.

## Scope

**1. Snapshots and the round-1 reference.**
- **The read.** A separate per-dispute `readEvidenceRecord`, for open disputes only, reads the six text fields and, for each file slot, the upload's `id`, name, type and size. It is not added to `DISPUTE_LIST_QUERY`: that query has no status filter, and `redactPII` would copy the text into `raw_snapshot`.
- **The table.** A row goes into `shopify_evidence_snapshots` on any change, and on every sync while a dispute is `under_review`. Columns: `dispute_id`, `cycle`, the raw fields, the file-slot metadata, one hash per clearable field, and `read_at`.
- **What counts as round-1 content.** The reference is **the last snapshot taken in the previous round while the dispute was `under_review`**: the state Shopify held after round 1 was submitted, before the reopen. It is not the first snapshot after the reopen. Text that still equals that reference is provably round-1 content. Anything else was added after round 1 closed, possibly in the minutes after the reopen, and is kept.
- **No reference** (a dispute reopened before snapshots shipped, or never seen `under_review`): nothing is provably round-1. We **keep everything, file the letter, and alert** (`retained_text_unverified`). No clearing without proof.
- **PII.** The table goes into `scrubCustomerData.ts`, the shop-redact route, `customers-data-request` and `retention-cleanup`. Snapshots never gate a save.

**2. Text in scope.** Three free-text fields: `uncategorizedText`, `refundRefusalExplanation` and `cancellationRebuttal`. Together they form the `ClearableTextField` union.
- **Never changed:** the policy fields, `accessActivityLog` (Shopify's record), `productDescription` and the customer fields. They are shown on the page.

**3. Text on cycle ≥ 2: clear only proven round-1 content, race-safe.**
- **(a) In the save.** The steps below apply to each clearable field.
  1. The worker reads the live record **immediately before** the mutation.
  2. The field is cleared only if its live value's hash equals the round-1 reference **and** the merchant did not choose "Keep" for it.
  3. A differing live value is kept.
  4. The mutation is sent.
  5. The record is **re-read after** the mutation.
  6. **Mismatch handling.** Shopify has no conditional update, so there are two cases:
     - A pre-read already different from the reference means that field is not cleared (step 3).
     - If the post-read shows a value that is neither empty nor the pre-read, the merchant wrote during the call. We audit it and alert, and we never write again in that job.
  7. **Every clear stores the exact before value** in the audit row (`retained_text_cleared`: field, before, after, `read_at`), so any clear can be restored from the page with one click ("Put it back", `submitEvidence: false` while unfiled).
  8. The window left between the pre-read and the call is the length of one API request. It can't be closed without a conditional update, and the stored before value covers it.
- **(b) Standalone clear when we cannot file (D5, conditional).** It runs only when **all** of these hold:
  - the test-store check (Rollout 2) showed that a `submitEvidence: false` clear persists and leaves `status`, `evidenceSentOn` and our submission state unchanged;
  - the dispute is cycle ≥ 2, with a round-1 reference, and at least one field provably equals it;
  - it is **deadline minus 24 h** and the pack is still not fileable (not `ready`/`saving`, or `bankClaimBlocksFiling()`, or no free file slot per §4). Running late leaves the filing path the full time to succeed first.

  The job then:
  - follows the same pre-read → mutate → post-read steps and stores the before values;
  - verifies by the post-read that the field is empty;
  - audits the result.

  **The merchant sees:** "We couldn't file DisputeDesk's letter before the deadline, and removed text sent in the previous round so it wouldn't be repeated. Shopify will submit what the dispute holds." This appears on the dispute page, with a "Put it back" link while the dispute is still unfiled, plus an email that informs and asks for nothing. The admin gets the no-file alert. The outcome is recorded as **not a defence**: it is a lesser harm, not a filed response.

**4. Files: never removed unless ours, and the letter goes beside them.** A file's upload `id` is compared with the snapshot:

| What `uncategorizedFile` holds at save time | Action |
|---|---|
| Empty | Our letter goes there |
| Our own earlier upload (`isDisputeDeskFile`), superseded | Our letter replaces it. **This is the only automatic replacement.** |
| Any other file (in the round-1 reference, added since, id changed, or unreadable) | **Kept.** Our letter goes into the first free, verified slot |
| Slot unreadable after 3 retries | Treated as "any other file": our letter goes into a second slot |

- **The second slot.** We try `serviceDocumentationFile`, then `customerCommunicationFile`, then `shippingDocumentationFile`, and use the first one that is empty at the pre-mutation read. The policy slots are never used. A slot counts as usable only once Rollout 2 shows that a PDF there is submitted to the issuer.
- **No free usable slot: the one no-file case.** We flag a collision:
  - the admin gets an alert;
  - the card shows the slot and offers "Replace <file name> with DisputeDesk's letter" (in the app, while unfiled);
  - §3b can still run at deadline minus 24 h.

  This qualifies "we always file": we file in every case except this one, and this one is visible.
- **A file id that disappears** leaves the slot empty. **A changed id** is "any other file".
- **The F4 annex is removed.** It downloads the file first, and that only ever returns Shopify's encrypted envelope.
  - A new migration drops `merchant_file_approvals` (no rows), applied to dev and prod.
  - Delete `merchantFileAnnex.ts` and `MERCHANT_FILE_ANNEX_ENABLED`.
  - Rewrite `merchantFileGuard.ts` and its test as the §4 table.
  - Update `docs/technical.md:941`.
  - Keep the historical audit event name in the `logEvent.ts` union.

**5. Merchant review, in the app only.**
- An "Already in Shopify" card on the dispute page (embedded, portal, mobile) lists the retained text and files and what will happen to each, with the "Open in Shopify Admin" link.
- **Before filing** it is interactive: "Keep" for text, "Put it back" for a clear, and "Replace" only in the §4 collision case. In review mode it rides the approve click.
- **After filing** it is a read-only record, because submitted evidence can't be changed.
- Choices are stored in `retained_evidence_choices`: `dispute_id`, `cycle`, `item`, `item_hash`, `choice`, `decided_by_user_id`, `surface`, `decided_at`, with history. A changed item gets the default again.
- In auto mode, an email says where to see the record.

**6. Save worker and contracts.**
- `readEvidenceRecord` replaces `readUncategorizedFile`.
- `composeShopifyMutationPayload` gains `clearFields: ClearableTextField[]` and a target file slot. The "no text fields, uncategorized only" contract is amended to match.
- `diffVerificationReadback` confirms a cleared key iff the readback is empty or the sentinel, and confirms our file by slot, name and size.
- **A non-retriable refusal:**
  - sets the pack to `blocked` (`lib/types/packStatus.ts:28`) with a `blocked_reason` and reason-aware copy;
  - raises attention;
  - calls the no-file admin alert, moved from the cron closure into `lib/`.
  - `blocked` is made re-enterable at `saveToShopifyJob.ts:77`, `lib/defence/enqueue.ts:83` and `app/api/packs/[packId]/approve/route.ts:62`.
- Fix the false comment at `disputeEvidenceUpdate.ts:21`.

**7. Our letter never sees snapshot content.** It is never passed to the writer.

**8. Cycle 1: observe only.** We write snapshots (they become the next round's reference) and change nothing.

**9. D7: the bank's claim becomes optional.** `needsBankClaim()` no longer blocks filing forever.
- Without a pasted claim, we file a claim-neutral letter from the current reason code at **deadline minus 2 days**, before §3b's 24 h mark.
- A claim pasted before then still shapes the letter. The card stays.
- `bankClaimBlocksFiling()` returns false once that time has passed. The deadline cron and the save worker read the same predicate.

## Decisions

| | Decision | State |
|---|---|---|
| D1 | Clear round-1 text by default on reopen | Yes (user), narrowed to *proven* round-1 content (§1, §3) |
| D2 | Mein Maison: nothing erased before you have seen it | Yes (user). You have seen the text. The one-off is below |
| D3 | Shopify's activity log | Untouched (user) |
| D4 | Read the files first | Superseded: files can't be read |
| D5 | Standalone clear when we can't file | **Conditional yes** (review): only after the test passes, at deadline minus 24 h, verified, and shown to the merchant (§3b) |
| D6 | Replace a round-1 file by default | **No** (review). Replaced by §4: keep foreign files, letter in a second slot, auto-replace only our own superseded upload |
| D7 | Bank's claim optional, with a deadline fallback | **Yes** (review, §9) |

## Mein Maison one-off (#99142 due 10-01, #94866 due 10-02)

**Text only. The PDFs are not touched.** The full build can't ship by these dates. The one-off runs only if Rollout 2 has shown that an empty-field update with `submitEvidence: false` persists and changes neither `status` nor `evidenceSentOn`.

1. `scripts/shopify/clear-retained-text.mjs --dry-run` prints the exact before values.
2. With your go, run it on #99142:
   - pre-read → clear `uncategorizedText` → post-read;
   - record the before and after values and the status check here.
3. Show the result. With your go, do the same on #94866.
4. If the test or your go misses a date, that dispute goes out the way Shopify holds it, and that is recorded here.

## Shopify question

A follow-up on the Hanad thread asks whether an app can download a readable copy of a dispute file. The plan does not depend on the answer.

## Rollout

1. ✅ Read-only measurement.
2. **Test-store checks (approved).** Record the results here:
   - Does `""` or `null` clear a field?
   - Does a `submitEvidence: false` write persist, leaving `status`, `evidenceSentOn` and the reopen detection unchanged?
   - What does the deadline auto-file send?
   - Is a PDF in `serviceDocumentationFile`, `customerCommunicationFile` or `shippingDocumentationFile` submitted, and how is it labelled?
   - Does replacing `uncategorizedFile` detach the old upload?
   - Does an upload keep its `id` across a reopen?
3. **Observe-only snapshots (approved):** develop, then prod. They start building round-1 references now.
4. The Mein Maison one-off (above), per your go.
5. **Live clearing (§3), the file rules (§4), D7 (§9), annex removal and the card.** Not approved yet. Develop first, then prod with per-change approval once the test results are recorded.

## Tests

- **Round-1 reference.**
  - Text equal to the previous round's last `under_review` snapshot is cleared.
  - Text that differs, including text written minutes after the reopen, is kept.
  - With no reference, nothing is cleared, we still file, and `retained_text_unverified` is alerted.
- **Race.**
  - A pre-read that differs from the reference means no clear.
  - A post-read that shows a new value means an audit and an alert.
  - Every clear stores its before value, and "Put it back" restores it.
- **Standalone clear (§3b).**
  - Runs only when the test flag is set, and only at deadline minus 24 h.
  - Runs only on unfileable cycle ≥ 2 packs with a reference.
  - Is verified by the post-read.
  - Never stamps `evidence_saved_to_shopify_at` or `submitted_at`, and never opens a cycle.
  - Shows the merchant copy.
- **Files.**
  - A foreign file is never replaced; our letter goes into the first free, verified slot.
  - Only our own superseded upload is replaced.
  - With no free slot, a collision is flagged and nothing is replaced.
  - An unreadable slot after 3 retries uses a second slot.
  - No code path downloads file contents.
- **D7.**
  - Before deadline minus 2 days, filing is held for the claim.
  - After that, a claim-neutral letter is filed.
  - The cron and the worker use the same predicate.
- **Card.** Interactive only while unfiled; read-only afterwards.
- **Payload.** Only `ClearableTextField` keys are ever cleared (type test).
- **Privacy.** `raw_snapshot` never contains evidence text, and the letter writer never receives snapshot content.
- **Copy.** Six locales, plus the help article "What DisputeDesk does with evidence already in Shopify".
