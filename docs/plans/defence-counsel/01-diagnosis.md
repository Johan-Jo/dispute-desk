# Plan 1: Diagnosis. Why every version failed

Case: blume-box #352543 (see the README). Every version below was rejected by the maintainer. Read them before designing anything, so the next attempt doesn't repeat them.

## 1. The versions, verbatim

### A. The model's own draft (prompt v33, 24 Sep): overstated and repetitive
The model stated the delivery five times: opening line, summary, shipping section, again with the URL, and in the conclusion. The conclusion asked for reversal twice. It also wrote claims the record does not support:
> "The carrier's delivery confirmation is consistent with successful completion of the merchant's shipping obligation."
> "…each independently corroborating the same delivery date and time."
> "…consistent with a cardholder-initiated transaction under Visa 13.1…"

Verdict: repetitive, overstated, and "not well argued".

### B. Record-built template (v34): a single sentence of argument
> **Stallion Express recorded the shipment for order #352543 as delivered on 6 July 2026; the dispute was opened on 19 September 2026.**
> The carrier's delivery record contradicts the claim that the item was not received.

Verdict: "a really boring, objective listing of the facts… not written in a defence letter mode."

### C. Record-built "chain" template (v36–v39, the version currently filed)
> The merchant contests this non-receipt chargeback. Linked order, fulfilment and carrier records connect the purchased goods to the tracked shipment and its delivery event, an affirmative basis to contest the claim in full.
> The fulfilment record places all three purchased items in the single shipment shown above, and the carrier then recorded that shipment as delivered.
> This distinction matters. The merchant does not rely only on its own record that the order was dispatched: the carrier's record reports the delivery itself…

Verdict: it explains the records instead of using them to make the case.

### D. Pilot: claim ledger plus an "advocacy" prompt, run on three models
The executive summaries (full outputs are in `case-352543/pilot-output.*.txt`):
> **Sonnet 4.6:** "Blume submits that the cardholder's non-receipt claim is answered in full by the carrier's own delivery record and the merchant's fulfilment mapping of every item in the order. Because Stallion Express recorded delivery of the one shipment that held all three purchased items in their ordered quantities, there is no gap in the order the cardholder's claim can occupy."
>
> **Opus 5.5:** "Blume's position is that the cardholder's claim that the merchandise was not received (Visa 13.1) is answered by the carrier's delivery record. The claim fails in full because the carrier recorded as delivered the one shipment that held the entire order."
>
> **GPT-6 Astra:** "Blume's evidence answers the cardholder's Visa 13.1 claim that the merchandise was not received. The claim fails in full because the carrier recorded delivery of the single shipment containing the entire order."

Verdict: "they're all bad… if you think this is good counselling, you should really go and update yourself… speaking objectively about data points… without any punchline at all."

## 2. Root causes

1. **The model's job was defined as transcription.** The production prompt says: "You are *not* investigating… You are converting approved facts into professional prose." A model told to transcribe produces a transcript. (Appendix A, block 1.)

2. **The production prompt is built from fear.** Of about 13,800 characters, almost all are prohibitions written after past failures: forbidden words, forbidden claims, "NO EXAMPLE SENTENCES ARE GIVEN HERE", "Restraint is more persuasive than confidence", "Stop at the evidence", "DO NOT CLOSE A SECTION BY RESTATING THE DELIVERY". Not one line says how to persuade. Each failure added a ban, and nothing was ever added about how to win.

3. **The model's writing is thrown away anyway.** For non-receipt letters with a carrier-confirmed delivery, `lib/defence/shipmentRecordSections.ts` replaces every section with fixed sentences. The filed letter (C) is a template. Any prompt improvement is currently invisible on these cases.

4. **The "each fact once" rule was over-applied into "no concrete facts in the prose".** The maintainer objected to repeated *identifiers and tables*: the order number, the tracking number, timestamps, arithmetic already in the table. The implementation then banned dates, numbers and names from the prose altogether. That forced the model to write in abstractions ("the delivery", "the dispute", "the record", "the shipment"), and abstraction is exactly what reads as "objective data points with no punchline". Concrete, well-chosen specifics are what give an argument force: *four days after it shipped*, *the same day*, *seventy-five days later*. **Plan 2 resolves this rule properly: repeat no identifier, but use any specific fact that does work in the argument.**

5. **The pilot's "advocacy" was surface-level.** It raised the confidence of the words ("decisive", "fails in full", "straightforward") and added meta-talk ("Blume's position is…", "the claim fails because…"). It did not build an argument. Missing:
   - **A theory of the case:** one idea the whole letter serves.
   - **A punchline:** an opening that makes the analyst's decision feel already made.
   - **Narrative:** what happened, told as a sequence the reader can't argue with.
   - **Contrast:** the cardholder's claim set against the record.
   - **Framing of the claim:** stating what the cardholder must be claiming, and why the record makes that untenable.

   It also opened with the analyst's *doubt* ("the issuer does not need to take the merchant's word"), which puts the idea of doubt in the reader's mind.

6. **Sentence-level bookkeeping produced list-like prose.** Requiring every sentence to cite ledger IDs made the model write one checkable claim per sentence. That is safe and reads like an inventory. Claims must be checked, but the writing should be free to be rhetoric (Plan 4 moves the check from the sentence to the claim).

7. **Evidence starvation.** Only two facts reach the model (`delivery_proof`, `shipping_tracking`). The evidence pack also holds the following, and the model never sees any of it:
   - customer history: 2 orders, and "repeat customer" is set;
   - IP geolocation: same country as the shipping destination, no VPN or proxy, low risk;
   - Apple Pay as the wallet;
   - billing and shipping in the same city;
   - the published shipping policy;
   - the notification emails' exact recipient.

   See Plan 3. Some of this is relevant to non-receipt; all of it was cut before the model saw it.

8. **Fixed sections spread thin evidence thinly.** Five sections, each told to say "something new", split two facts five ways. The result is five weak paragraphs where one strong argument, then supporting sections, would be better. Plan 2 defines what each section is *for* in a persuasive structure.

9. **The previous implementer evaluated compliance, not persuasion.** Each version was checked against rules (no repetition, no banned phrase, validator passes), not against the only question that matters: *would an analyst side with the merchant after reading the summary?* Plan 5 makes that the gate.

## 3. What must not be lost while fixing this

These guard real past failures; each is documented in the code or the plans:
- no delivery-destination or address claims;
- no personal-receipt claims;
- no "independent corroboration";
- no stating a limit or weakness;
- no restating the header or tables;
- no claims beyond the records.

The fix is to add *advocacy*, not to remove *truth*.
