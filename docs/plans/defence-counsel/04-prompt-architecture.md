# Plan 4: Prompt architecture. What the model is sent, and how the output is checked

Today's model call is in Appendix A: one call with four system blocks, almost entirely prohibitions, plus two facts as JSON. Its output is then discarded for non-receipt letters. This plan replaces that for families that opt in, starting with **item not received**.

## 1. Pipeline shape

```
records ──► claim ledger (Plan 3, code) ──► [1] STRATEGIST ──► case plan
                                                   │
                                                   ▼
                                          [2] WRITER ──► draft letter (N candidates)
                                                   │
                                                   ▼
                     [3] CHECKS (code): claim grounding · forbidden content · copy rules · anti-pattern lint
                                                   │  fail → one corrective retry with the exact findings
                                                   ▼
                                          [4] JUDGE (Plan 5 rubric) picks the best passing candidate
                                                   │
                                                   ▼
                                     compose PDF (existing layout, headline from the draft)
```

Why split the strategist from the writer: every rejected draft failed at the *strategy* level (no theory of the case, no punchline), not at the sentence level. Making the model commit to a theory and a punchline first, as its own output, forces the step it kept skipping. It also makes the step reviewable on its own.

## 2. [1] Strategist call

**Input:** the ledger (claims with weights, specifics and private limits), the reason code and the cardholder's claim type, the reason-code playbook (§4: the analyst's question, theories, allowed evidence sections in default order), and the frame (Plan 2 §2.4).

**Output (JSON):**
```json
{
  "theoryOfTheCase": "one or two sentences: what happened, told so the claim cannot survive it",
  "punchlineCandidates": ["3 alternative opening sentences, each contrasting the claim with the record and carrying a concrete specific"],
  "reasonsInOrderOfForce": [{ "claimIds": ["carrier_delivered"], "point": "…" }],
  "theoryChosen": "which playbook theory this case uses",
  "sectionPlan": [
    { "key": "summary",    "claimIds": [], "job": "…" },
    { "key": "shipping",   "claimIds": [], "job": "what this exhibit proves for this claim" },
    { "key": "chronology", "claimIds": [], "job": "…" },
    { "key": "conclusion", "claimIds": [], "job": "…" }
  ],
  "omittedSections": [{ "key": "lineItems", "why": "adds nothing to this theory" }],
  "specificsPlacement": { "4 days": "chronology", "75 days": "summary" }
}
```
The last field puts each specific in exactly one section. That enforces the copy rule by construction.

## 3. [2] Writer call

**System prompt: required parts and their order.** The final wording is the implementer's job; these are the requirements.

1. **Role.** "You are the merchant's chargeback counsel. You win cases. You write the response an issuer's dispute analyst will read in two minutes."
2. **The reader.** How analysts read (Plan 2 §1): the summary decides the case.
3. **The standard.** Plan 2 §2 in full: theory of the case, punchline first, concrete specifics, the section jobs, and the advocacy techniques. **Include positive examples of register** written for a DIFFERENT case (a synthetic one), so the model copies the *shape*, not the words. Never put example sentences for the live case in the prompt.
4. **The anti-patterns.** Plan 2 §4, with the rejected examples quoted. Printing a rejected *style* is safe. The earlier rule against printing examples was about *banned claims*: a model copies a false claim it has been shown, but it doesn't copy a named anti-pattern of style.
5. **Truth limits.** Plan 2 §3, short and absolute. The ledger's `mustNot` entries are private constraints.
6. **The copy rule,** correctly scoped (Plan 2 §2.3).
7. **Input contract.** "You may state only what the ledger claims. You may choose, order, combine and draw inferences from them, stated as the merchant's position. A number, date or name must come from a claim's `specifics`."
8. **Output schema** (§5).

**User message:** the ledger, the strategist's case plan, and the case context (the page already shows the order number, tracking number, amount and dates, so the model knows what not to repeat).

**Candidates:** generate 3 drafts (temperature about 0.7 on models that accept it), then check and judge them. Best of 3 costs cents and removes the "sometimes good, sometimes flat" variance seen in the pilot.

## 4. Reason-code playbooks: they own the middle of the letter

One playbook per claim family, sent as a system block. It owns everything between the summary and the conclusion (Plan 2 §2.4). Build each one from the Visa Dispute Management Guidelines (the maintainer's preferred source) and the Mastercard equivalent. Each playbook defines:

```ts
interface Playbook {
  family: ReasonCodeFamilyKey;
  analystQuestion: string;          // the one question the issuer decides on
  theories: Array<{                 // winning case theories, with the claims each needs
    name: string; requiresClaims: string[]; punchlineShape: string;
  }>;
  sections: Array<{                 // evidence sections in DEFAULT order of force
    key: EvidenceSectionKey;        // "shipping" | "lineItems" | "chronology" | "authentication" | "customerHistory" | "listing" | "policy" | "communication" | …
    mustProve: string;              // what this exhibit proves FOR THIS CLAIM
    includeWhen: string[];          // claim ids; the section is omitted when none is present
  }>;
  leaveOut: string[];               // evidence irrelevant to this claim; never shown or argued
  never: string[];                  // family-specific truth limits (on top of Plan 2 §3)
}
```

### The playbooks at a glance (the default evidence order; the strategist may adapt it per case)

| Claim | Analyst's question | Evidence sections, strongest first | Leave out |
|---|---|---|---|
| **Item not received** (Visa 13.1 / MC 4855) | Was it delivered, and all of it? | Carrier delivery (shipment card) → whole-order scope (line items) → timeline, including the same-day delivery notice and the interval before the dispute → post-delivery contact or orders (when present) | Payment authentication, IP, AVS |
| **Fraud / not authorised** (10.4 / 4837) | Did the real cardholder make this purchase? | Authentication (3-D Secure, Apple Pay, verified card-code and address results, quoted only by the existing verified-wording rule) → the same customer's history (earlier undisputed orders, account age, same device or IP) → activity after the purchase → delivery (secondary) | Line-item arithmetic; shipping as the lead |
| **Not as described** (13.3) | Did they get what was advertised? | The listing as shown at purchase → what was sent (items, variants) → the customer's messages and the return offered → policy | Delivery as the lead (not disputed), IP |
| **Credit not processed** (13.6) | Is a refund owed? | Policy terms accepted at checkout → the return record → the messages | Delivery, authentication |
| **Cancelled subscription** (13.2) | Was it cancelled before this charge? | Terms accepted → cancellation record → use after the claimed cancellation → notices sent | Shipping |
| **Duplicate** (12.6) | Are these two separate purchases? | The two orders side by side: items, times, fulfilments | Almost everything else |

### Item not received: the first playbook in full
- **Analyst's question:** was it delivered, and was all of it delivered?
- **Theories:**
  - *Delivered and notified.* Carrier delivery, the same-day delivery notice, and the interval before the dispute.
  - *Whole order in one tracked shipment.* This closes the partial-delivery escape.
  - *Ordered again after delivery,* when Plan 3 Q1 confirms it.
  - *Delivered after the dispute opened* (a different lead: the claim is now answered).
  - *Signed for.*
  - *Several parcels, some delivered* (argue the delivered ones; never volunteer the others' status).
- **Core claims:** `carrier_delivered`, `carrier_is_third_party`, `whole_order_in_shipment`. **Strong:** the timing and notification claims.
- **Never:** destination or address, personal receipt, absence arguments, lateness under the network rules.

Build order: item not received first, with the reference case and #360980. Then fraud, which has the most volume and very different evidence. Then the rest.

## 5. Output schema (writer)

```json
{
  "headline": "the punchline, printed in the pull-quote above section 01 (replaces today's template headline)",
  "summary": { "paragraphs": ["…"], "claimIds": ["…"] },
  "evidenceSections": [
    { "key": "shipping",   "paragraphs": ["…"], "claimIds": ["…"] },
    { "key": "lineItems",  "paragraphs": ["…"], "claimIds": ["…"] },
    { "key": "chronology", "paragraphs": ["…"], "claimIds": ["…"] }
  ],
  "conclusion": { "paragraphs": ["…"], "claimIds": ["…"] }
}
```
`evidenceSections` is **ordered**: the renderer prints them in this order, numbered in sequence. Only keys the playbook allows are accepted, and a section with no prose is omitted, together with its exhibit when that exhibit has no other purpose.
Claims are cited **per section, not per sentence** (Plan 1, root cause 6), so the writing can breathe.

Today the headline is a code template (`lib/defence/pdf/thesisTemplates.ts`, `executiveSummary:item_not_received`). For opted-in letters the model writes it and code checks it. The layout does not change; only the text in the pull-quote does. **The maintainer must approve this change** (CLAUDE.md rule 8: the design is spec, and this changes the design's content, not its structure).

## 6. [3] Checks (code), replacing sentence bookkeeping

1. **Grounding.** Every date, number, amount, day-count, carrier name and item count in the text must match a `specifics` value of a claim cited in that section. Anything else is rejected.
2. **Forbidden content.** Reuse what exists, unchanged:
   - `validateNarrative`: INR `prohibitedBankPhrases` and guarded phrases;
   - `claimGuards` (rule 14, destination);
   - `deliveryPostDatesDispute`.
   These encode real past failures (Plan 1 §3).
3. **Copy rule.** No order number, tracking number, time of day or card digits. Each specific at most once across the letter.
4. **Anti-pattern lint (new).** Regexes for throat-clearing ("… position is that", "submits that"), meta-talk ("this distinction matters", "is material"), disclaimers ("not proof", "does not rely", "context only"), adjective-for-evidence ("decisive", "straightforward"), and defensive framing ("does not need to take", "word for it").
5. **One corrective retry.** The exact findings are fed back (the pilot showed this works). If it still fails, fall back to today's record-built template: a safe letter always files.

## 7. Models

The pilot compared Sonnet 4.6, Opus 5.5 and GPT-6 Astra, and all three failed on *direction*, not on ability. So choose the model *after* the new prompt exists, by the Plan 5 evaluation. Candidates: Opus 5.5 (writer and strategist), GPT-6 Astra, and Sonnet 5. The staging pilot route already supports the Anthropic models; GPT-6 Astra can be called locally (the key is in `.env.production.local`).

## 8. What happens to today's prompt
- `BASE_SYSTEM_PROMPT` stays for families that haven't opted in.
- For opted-in families, the new prompt and pipeline are used behind a flag (`DEFENCE_COUNSEL_V2_FAMILIES=item_not_received`). The record-built templates (`shipmentRecordSections.ts`) become the **fallback only**.
