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

**Input:** the ledger (claims with weights, specifics and private limits), the reason code and the cardholder's claim type, the reason-code playbook (§4), and the section jobs (Plan 2 §2.4).

**Output (JSON):**
```json
{
  "theoryOfTheCase": "one or two sentences: what happened, told so the claim cannot survive it",
  "punchlineCandidates": ["3 alternative opening sentences, each contrasting the claim with the record and carrying a concrete specific"],
  "reasonsInOrderOfForce": [{ "claimIds": ["carrier_delivered"], "point": "…" }],
  "sectionPlan": {
    "summary":     { "claimIds": [], "job": "…" },
    "shipping":    { "claimIds": [], "job": "…" },
    "lineItems":   { "claimIds": [], "job": "…" },
    "chronology":  { "claimIds": [], "job": "…" },
    "conclusion":  { "claimIds": [], "job": "…" }
  },
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

## 4. Reason-code playbooks

Each playbook is a system block per family: what the network considers compelling evidence, which theories win, and which claims are core. Build the first one from the Visa Dispute Management Guidelines (the maintainer's preferred source) and the Mastercard equivalent.

**Item not received (13.1 / 4855), the first playbook:**
- **The analyst's question:** was it delivered, and was all of it delivered?
- **Winning theories:**
  - *Delivered and notified.* Carrier delivery, the same-day delivery notice, and the time that passed before the dispute.
  - *Whole order in one tracked shipment.* This removes any partial-delivery escape.
  - *Ordered again after delivery,* when Q1 confirms it.
- **Core claims:** `carrier_delivered`, `carrier_is_third_party`, `whole_order_in_shipment`. **Strong:** the timing and notification claims.
- **Never:** destination or address, personal receipt, absence arguments, lateness under the rules.

Later playbooks: fraud (10.4 / 4837: authentication, wallet, IP, history), not as described (13.3), credit not processed (13.6), duplicate (12.6), subscription cancelled (13.2).

## 5. Output schema (writer)

```json
{
  "headline": "the punchline, printed in the pull-quote above section 01 (replaces today's template headline)",
  "summary":    { "paragraphs": ["…"], "claimIds": ["…"] },
  "shipping":   { "paragraphs": ["…"], "claimIds": ["…"] },
  "lineItems":  { "paragraphs": ["…"], "claimIds": ["…"] },
  "chronology": { "paragraphs": ["…"], "claimIds": ["…"] },
  "conclusion": { "paragraphs": ["…"], "claimIds": ["…"] }
}
```
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
