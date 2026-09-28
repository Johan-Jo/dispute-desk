# Defence letters that argue — one frame, a counsel playbook per claim

**Status:** rev 3, 2026-09-28 (evening). Rewritten after the maintainer rejected the rev-2 test print:
*"What happened to the advocacy to argue? You're just stating facts here. … I see no argumentation at all."*
**Standard:** `docs/plans/defence-counsel/02-counsel-standard.md` (approved 2026-09-25) is binding for every letter. A letter that does not meet it is not done, however many checks it passes.
**Writer:** counsel v2 only. The template writer is retired permanently (maintainer, 2026-09-28).

---

## 0. Two rejections, one cause

| Letter | Maintainer | What was wrong |
|---|---|---|
| #101111, template writer (morning) | "why are you mixing in German and product details? … You lost the complete sequence. What about delivery? What about opening the chargeback?" | Wrong writer; German specs in the prose; two timeline rows |
| #101111, counsel test print (evening) | "You're just stating facts here. … I see no argumentation at all." | Right facts, right frame, no argument |

The second letter fixed the facts and lost the advocacy. It had the sequence, English, PayPal wording and a full timeline. But it read as a list: "The item was sold under a published listing… The carrier recorded delivery… The record shows a completed sale under a published listing and a delivered order." None of that answers the claim that the item was not as described.

## 1. Why the test print did not argue (verified against the code)

1. **The model was given a transcriber's brief.** `SUMMARY_SYSTEM_NOT_AS_DESCRIBED` told it to state the claim, list the sequence, add "one sentence that says what the record establishes" (example: *"a completed sale under a published listing and a delivered order"*), then make the request. There was no theory, no contrast, and no "narrow the question, then answer it".
2. **Code wrote every other word.** "What was sold", "Delivery and return" and the conclusion are fixed sentences (`recordSections.ts`). They report a record and never say what it proves, so no section has a persuasive job. This is the pattern the 25 September advocacy diagnosis named: *"This fixed the symptom (untrue sentences) by removing the advocacy."*
3. **The bans removed the argument's levers.** The writer could not mention returns, could not say what the listing shows, and could not name the item. What it had left was a sequence of dates.
4. **The checks tested truth, never persuasion.** They passed on the first draft. Nothing asked whether the analyst would decide for the merchant.
5. **Root causes carried over from rev 2** (still true, still in scope):
   - the template writer wrote 58 of 60 prod letters;
   - counsel skipped PayPal and Klarna;
   - delivery was removed from not-as-described letters;
   - an inquiry had no "dispute opened" row;
   - the letter said "chargeback" on a PayPal inquiry.
   All of these are fixed on develop (§11).

## 2. What arguing means here

The counsel standard, applied to every letter:

1. **A theory of the case, told as a story.** Before writing, decide the one account the evidence makes true and that defeats the claim. Every section serves it.
2. **A punchline first.** The first sentence sets the claim against the record, with one concrete specific.
3. **Narrow the question, then answer it.** Say what this claim type turns on, then answer it from the record.
4. **Every section has a persuasive job.** Under its exhibit, each section says what the exhibit proves for *this* claim. The test: delete a section's prose and the letter gets weaker.
5. **Contrast, and third parties as the subject.** "The customer says … The carrier recorded …"
6. **Let facts imply what may not be said.** An interval implies what we may not assert.
7. **Truth limits are unchanged** (standard §3): no address, no personal receipt, no bad faith, no lateness under network rules, no printed weakness, no "independent", no red-flag adjectives. The one change is D4 (§9).

## 3. Architecture: the model argues, code bounds it

| Part | Today (rev 2) | Rev 3 |
|---|---|---|
| Claim ledger | Code, from records | Unchanged: code, from records. Each claim has an id, a true sentence, allowed specifics and private limits. |
| Theory | Code picks one | Unchanged: code picks it, and it now carries the **story** and the **argument per section** (§5) |
| Summary | Model, ~60 words, a list | Model: punchline, the reasons in order of force, the request |
| Evidence sections | Code, fixed sentences | **Model**: 1–3 sentences each, the argument the playbook gives that section, grounded in ledger claims |
| Conclusion | Code | **Model**: the theory in one sentence, then the frame's request |
| Truth check | Code checks + review | **Whitelist validation.** Every sentence must cite ledger claim ids; a sentence the checker cannot map to a permitted claim is refused. The existing bans, English checks, frame checks and copy checks stay. |
| Persuasion check | None | **Issuer-analyst judge** in the eval gate (§8): decides for the merchant from the summary alone, and names the section whose deletion would weaken the letter |

Code-owned sentences survive only where the wording is a legal limit: the return line (§5.3) and the translation caption.

The model is Sonnet 4.6 now. D5 (§9) runs the Opus 5.5 comparison on the eval set, as the 25 September plan proposed. That plan estimated the cost difference at cents per letter.

## 4. The frame (every claim type) — built

- **Header and case table (code).**
  - Provider-correct label and page title ("Chargeback response", "Inquiry response", "Dispute response").
  - A non-card case table shows "Payment method" and "Customer name" and no card rows.
- **Executive summary (model, ≤ 80 words, English).**
- **Evidence sections (model, playbook order).**
- **Chronology (code), complete for every claim type:** ordered → paid → shipped → delivered → dispute opened → return state. The opening row is added when Shopify has none.
- **Conclusion (model) and one request (code, from the frame).**
- **English only.**
  - The model-written text may not contain store titles, non-English letters or non-English function words.
  - Tables and cards keep the store title as a record identifier (D2, yes).
  - A non-English listing exhibit prints a checked machine translation (D3, yes).

## 5. The not-as-described playbook, as an argument

**Analyst question:** "Was the item different from what was advertised?"

**What we can and cannot see.**
- Shopify does not give us the customer's complaint, so we cannot rebut its specifics.
- We can show what was advertised, that it was delivered, when the dispute came, and what the store's return route is and whether it was used.
- The argument is built from those.

### 5.1 Theory of the case (the story the letter makes true)

> The customer bought the item from a published listing, with photographs and a written description, that is on file in this response. The carrier delivered it on 18 September. The store offers a return route for goods a buyer is not satisfied with, and Shopify records no return. Eight days after delivery, the customer opened a dispute with PayPal instead.

The analyst should conclude, without being told, that the advertisement is on the table and that the store's own remedy for "not what I expected" was never used.

### 5.2 Section jobs

| Section (exhibit) | Its argument | Example shape (invented case; the model copies the shape, never the words) |
|---|---|---|
| **Summary** | Punchline: the claim against what is on file. Then the reasons in order of force: the listing, delivery, the return route, the interval. Then the request. | "The customer says the lamp was not as described. What was described is on file: the listing the lamp was sold under, with its photographs and text. The carrier delivered it on 4 March; the store offers returns, and Shopify records none. Fifteen days after delivery the customer opened a dispute instead. The merchant requests …" |
| **What was sold** (listing exhibit + translation) | The question a not-as-described claim turns on is answered by the advertisement, and here it is, as published. | "A not-as-described claim turns on what the item was described as. That description is below, as published in the store, with its photographs and an English translation." |
| **Delivery and return** (shipment card) | The goods reached the buyer, and the store's return route shows nothing coming back. | "The carrier's own scan records delivery. The store's published refund policy offers returns; no return has been recorded in Shopify for this order." |
| **Chronology** (timeline) | No prose: the timeline carries the sequence, and the summary has already given the interval. | — |
| **Conclusion** | The theory in one line, then the request. | "The item was sold under the listing on file, delivered, and never returned through the store's return route; the not-as-described claim is not supported by the record." |

### 5.3 Ledger claims (code-built; the only facts the writer may use)

| Claim id | True sentence | Source and guard |
|---|---|---|
| `claim_is_not_as_described` | The claim is that the item was not as described. | dispute reason |
| `listing_published` | The item was sold under a published store listing with photographs and a written description, reproduced in the letter as retrieved from the store. | `product_listing_snapshots`. Never "what the customer saw at purchase". |
| `shipped` / `carrier_delivered` / `dispute_after_delivery` | Shipped {date}; the carrier recorded delivery on {date}; dispute opened {n} days later. | fulfilment + carrier record, `disputes.initiated_at` |
| `return_route_published` | The store's published refund policy offers returns. | Policy snapshot. Suppressed when the policy is adverse to this case (window expired at dispute time, or return postage at the buyer's cost) — merchant-counsel stance. |
| `no_return_recorded` | No return has been recorded in Shopify for this order. | `Order.returnStatus = NO_RETURN`. Withheld when a stored message shows return or refund intent. |
| `later_order` | The same customer ordered again on {date}. | customer orders |

### 5.4 Never (truth limits, unchanged)

- That the item matched, conformed to or was as described.
- That the listing is what the customer saw at checkout.
- The product's store name, its features or specs, or listing quotes in prose. The exhibit shows them.
- That the customer did not return it, did not try to, or never asked. Only "no return has been recorded in Shopify".
- That anyone received, kept or used the goods.
- Intent or bad faith.
- Leading with delivery as if non-receipt were claimed.

## 6. Other claim types

The same architecture, one playbook each, in this order (open prod disputes, 2026-09-28):

| # | Scope | Open | Argument in one line |
|---|---|---|---|
| 1 | Not as described (card, PayPal, Klarna) | 16 | §5 |
| 2 | Item not received: model-written sections, and the in-transit and no-carrier-delivery theories | 27 | The existing counsel INR letter keeps its theory; its sections gain model-written jobs |
| 3 | Credit not processed (mostly Cay, Klarna) | 10 | The refund the customer says was due — against the store's policy and what was returned |
| 4 | Counsel takes a captured bank claim (translated) | reopened disputes | Answer the issuer's own words point by point (Visa: "address each point") |
| 5 | Fraud, subscription, general, incorrect account details | 7 | Per network compelling-evidence lists |

## 7. The retirement in production (D1 = A, decided)

- **On develop, not in production:**
  - The template writer never runs.
  - The shared filing check refuses any template letter.
  - A spent counsel budget or a model error is retried.
- **Consequence under A:** open disputes whose claim type has no playbook get no DisputeDesk letter until one ships (§6).
- **Needed before A ships:**
  - merchant copy and email for "no letter yet", in 6 locales;
  - billing treatment for disputes that file nothing;
  - `defence_prompt_modules` reconciled in prod — prod serves module allow-lists from the database, and not-as-described v6 re-allows delivery facts.

## 8. The gate: nothing reaches the maintainer until it argues

1. **Unit tests.**
   - Ledger claims from the #101111 fixture.
   - Whitelist validation: an unmapped sentence is refused.
   - English checks, frame checks, chronology completeness.
2. **Offline eval** (`scripts/counsel/eval-counsel.mts`, issuer-analyst judge), on 5 real not-as-described cases including #101111. Passes only when:
   - the judge decides **for the merchant after the summary alone**;
   - its **theory of the case** matches §5.1;
   - it finds **no sentence the ledger does not back**;
   - its section-deletion answer names no section as removable;
   - zero red flags.
3. **The #101111 acceptance.**
   - The first sentence sets the claim against what is on file.
   - Each of the two evidence sections says what its exhibit proves.
   - No product name or spec in the prose.
   - Six timeline rows.
   - PayPal wording.
   - One request.
4. **ONE test print to the maintainer**, through the job path. The maintainer's "this is excellent counsel" is the only sign-off.
5. **Release** with per-change approval → reconcile modules → regenerate #101111 in prod and compare → the family's open disputes, deadline-first (#98483 is due 30 September).
6. **Cost:** measure against counsel's ≈ $0.016 per package. Model-written sections add one write and a larger review; the ceiling is 2× unless D5 says otherwise.

## 9. Decisions for the maintainer

- **D1** — A, after a test print. *Decided.*
- **D2** — the store title may stay in tables and cards. *Decided: yes.*
- **D3** — machine translation of a non-English listing, captioned. *Decided: yes.*
- **D4 (new)** — **may a not-as-described letter argue from the return route?** The wording would be "the store offers returns; no return has been recorded in Shopify", placed next to "the customer opened a dispute instead".
  - For: Visa's 13.3 guidance names "the cardholder never attempted to return" as a response. It is the strongest truthful lever we hold.
  - Against: the counsel standard bans absence arguments. The recommended wording asserts only what Shopify records, never that the customer did not try.
  - Recommendation: **yes, with that exact wording, code-checked.**
- **D5 (new)** — the letter model: keep Sonnet 4.6, or move to Opus 5.5 if it scores better on the eval set at an acceptable cost.

## 10. References

- **Visa — Dispute Management Guidelines for Visa Merchants (June 2024), Condition 13.3** (pp. 40–41): "Provide specific information or documentation … to refute the cardholder's claims … address each point that the cardholder has made"; "Advise that you have not received the returned merchandise and the cardholder never attempted to return … double check your incoming shipping records"; p. 9: evidence "in English or accompanied by an English translation".
- **Visa — return-before-dispute rule for 13.3 (19 Oct 2024):** secondary sources only (Chargebacks911, Chargeflow). Unverified against the Core Rules; no letter relies on it.
- **Mastercard 4853:** tailor the response to the sub-type; for not-as-described, the description and images as advertised, delivery confirmation and communications (summaries of the Chargeback Guide).
- **PayPal — Significantly Not As Described:** excluded from Seller Protection; won on the archived listing, photos and the communication record.

## 11. Built on develop (PR #915) and what rev 3 changes in it

- **Built:**
  - template writer retired, plus the filing gate;
  - non-card counsel; the frame; the dispute-opened row;
  - non-card case table; English checks;
  - listing translation with cache (`product_listing_translations`, applied to dev and prod);
  - delivery back in not-as-described (module v6, empty `familyOmitsArrival`);
  - return-intent constraint in six locales;
  - `canary-record-context.mts --counsel` preview.
- **Rev 3 replaces:**
  - `SUMMARY_SYSTEM_NOT_AS_DESCRIBED` (the transcriber brief);
  - `buildNotAsDescribedSections` (fixed sentences);
  - the theory shapes.
  In their place: model-written, whitelist-validated sections and the §5 theory.
- **Rev 3 adds:** the `return_route_published` claim (D4), whitelist validation, and the eval gate.

Two deviations decided while building rev 2 stand:
- A listing edited after the order is kept, with the retrieval-date caption, because `product.updatedAt` moves on any app edit.
- The return line does not require a messages integration, because the Shopify record is what it states.

## 12. Critic review record (rev 1 → rev 2)

Rev 1 got **REVISE**, with three blockers:
- **B1:** retiring the writer alone would still have filed template letters. → Filing gate.
- **B2:** PayPal cases could not reach counsel. → Non-card counsel.
- **B3:** "no return" claimed more than the record shows. → Worded to the Shopify record; withheld on return intent.

All three are fixed on develop. Majors M1–M8 were addressed in rev 2 (see git history of this file). Rev 3 has not yet been through a critic pass.
