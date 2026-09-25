# Plan 2: The counsel standard. What "excellent" means

The prompt, the evaluation rubric and the maintainer's review all use this definition. If a letter doesn't meet it, the letter is not done, however many rules it passes.

## 1. Who we are writing for

A card-issuer dispute analyst, reading dozens of responses a day and giving each one or two minutes. They decide one thing: *does the merchant's evidence defeat what the cardholder claims?* They skim. They read the first lines properly and glance at the rest for support. **The executive summary is where the case is won or lost.**

## 2. The five things excellent counsel does

### 2.1 A theory of the case, stated as a story
Before writing a word, decide the ONE account of events that the evidence makes true and that defeats the claim. Every section serves it. For a non-receipt claim with a carrier delivery, the theory is not "records connect the goods to a delivery event". It is what happened:

> *The merchant shipped the order the day it was bought. The carrier delivered it four days later, and the cardholder was sent a delivery notice that day. The cardholder disputed it seventy-five days later.*

A reader who accepts that story rules for the merchant. The letter's job is to make the story impossible to doubt.

### 2.2 A punchline first
The first sentence the analyst reads must carry the verdict. Set the cardholder's claim against the record:

- It names what the cardholder claims.
- It states, in plain words, what the record shows instead.
- It gives the one or two specifics that make the contrast undeniable.

It uses no throat-clearing ("Blume's position is that…", "Blume submits that…", "The merchant contests…"), no abstraction ("linked records connect…"), and no adjective in place of evidence ("decisive", "straightforward", "in full").

### 2.3 Concrete specifics, chosen for effect
Specifics carry the argument; abstractions drain it. Rather than "the carrier recorded delivery shortly thereafter", write "the carrier recorded delivery four days after dispatch". Rather than "the dispute came later", write "seventy-five days later".

**The copy rule, correctly applied** (resolving the over-correction in Plan 1, root cause 4):
- **Never repeat an identifier the page already shows.** No order number, no tracking number, no times of day, no card digits, no line-by-line arithmetic from the table.
- **Do use** a date, an interval, a count or a name when it makes the argument ("four days", "seventy-five days later", "all three items", "the same day"), and use each specific **once**, where it does the most work.
- **The amount** appears in the header and the request line. The prose says "the full amount" if it needs to.

### 2.4 Structure that moves the reader
The numbered layout stays (maintainer's decision). Each section has one persuasive job and must advance the case, not re-describe it:

| Section | Job | Test |
|---|---|---|
| **Pull-quote + 01 Summary** | The punchline (2.2), then the two or three reasons that carry it, in order of force | Could the analyst decide from this alone? |
| **02 Shipping & Delivery** (under the shipment card) | Why the carrier's record is the answer to *this* claim, and why it is trustworthy (a third party with nothing at stake, publicly checkable) | Does it make the card's data mean something? |
| **03 Order Line Items** (under the table) | Scope: the delivery covers everything the cardholder paid for, so the claim has nothing to stand on | Does it close the "maybe only part arrived" doubt without saying "doubt"? |
| **04 Chronology** (above the timeline) | The story in time, and its point: the sequence and the 75-day interval | Does the timeline below now read as proof? |
| **05 Conclusion** | The theory in one sentence, then the request | Does it land the case in one breath? |

### 2.5 Advocacy techniques to use
- **Contrast:** the claim versus the record ("The cardholder says… The carrier's record says…").
- **The carrier as the subject.** Evidence speaks for itself when the third party acts: "Stallion Express recorded…", not "the record shows that…".
- **Narrow the question, then answer it.** "A non-receipt claim asks one thing: was the order delivered? The carrier answered it on 6 July."
- **Short sentences for the blows.** Save the longer sentences for the reasoning.
- **Rule of three** for the reasons in the summary.
- **Inference stated as the merchant's position, from facts shown.** "The order was delivered" is the merchant's position. It is supported by the carrier's delivery record, and it may be stated plainly.
- **Let facts imply what may not be said outright.** Seventy-five days of silence after a delivery notice (see 3 for the limit) must be implied by the interval, never asserted as silence.

## 3. What counsel never does (truth and risk limits, not style)

| Never | Why |
|---|---|
| Say where the parcel was delivered, or that an address was verified, matched or correct | We hold no evidence tying the delivery to an address (CLAUDE.md, rule 14 of the current prompt) |
| Say the cardholder personally received, signed for, has or used the goods | Not in the record |
| Say the cardholder did not complain, did not contact the merchant, or did not return anything | Absence arguments: we cannot prove them, and they are a known issuer red flag |
| Say or imply bad faith, fraud, dishonesty or motive | Accusation loses cases |
| Say the claim is late or out of time under network rules | Not true: Visa allows 120 days for 13.1 |
| Print a limit, caveat or weakness ("not proof of…", "does not rely on…") | This volunteers harm, which a merchant's counsel never does |
| Call records "independent" or "corroborating" when they reflect one carrier event | This is an overstatement a reviewer can puncture |
| Use "irrefutable, undeniable, definitive, conclusively, baseless, fraudulent, invalid" | These are issuer red flags; confidence must come from facts, not adjectives |

## 4. Anti-patterns seen in rejected drafts (do not reproduce)

| Pattern | Example from a rejected draft | Problem |
|---|---|---|
| Throat-clearing | "Blume's position is that…", "Blume submits that…" | Delays the punch |
| Meta-talk | "This distinction matters.", "The sequence of events is material:" | Tells the reader it matters instead of showing it |
| Abstraction | "Linked order, fulfilment and carrier records connect the purchased goods to the tracked shipment and its delivery event" | A description of a database, not of what happened |
| Adjective for evidence | "decisive", "straightforward", "fails in full" | Asserted force, with no fact behind it |
| Defensive framing | "The issuer does not need to take the merchant's word" | Plants the doubt it wants to remove |
| Disclaimer | "though a sent email is not treated as proof of receipt" | Volunteers a weakness |
| Inventory | One checkable fact per sentence, all at equal weight | Reads like a list, with no hierarchy of force |

## 5. The quality bar (used by Plan 5)

A letter passes when **all** of these hold:

1. **Summary alone:** an analyst reading only the summary knows the theory of the case and leans toward the merchant.
2. **Punchline:** the first sentence contrasts the claim with the record and carries a concrete specific.
3. **Every section advances the case:** delete any section's prose and the letter gets weaker.
4. **No repeated identifier or point,** and no anti-pattern from section 4.
5. **Every factual statement traces to a ledger claim** (Plan 3), and nothing from section 3 appears.
6. **The maintainer says "this is excellent counsel".** No other sign-off counts.
