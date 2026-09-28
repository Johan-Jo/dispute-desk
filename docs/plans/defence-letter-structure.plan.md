# The defence writer — single source of truth

**Status:** rev 8, 2026-09-28. Critic rounds 1–4: REVISE → REVISE narrow → REVISE narrow → ACCEPT-WITH-RESERVATIONS; rev 8 writes in the round-4 reservations (§13). All maintainer decisions taken (D9 by provider, 2026-09-28). Build started; target: in production before Mein Maison #98483's deadline (30 September).
**Maintainer, 2026-09-28:** *"lift this up to a higher level now so that we work with one single source of truth when it comes to the writer, because we want advocacy and we want our writer to be independent of what type of dispute it is. … now that we slid it over from 'not delivered' to 'a faulty product', you lost it all, but it can't be like that. … It shall affect all dispute types."*

**This document is the single source of truth for how every defence letter is written: every dispute type, payment method (card, PayPal, Klarna), stage (chargeback, inquiry), and case shape (single parcel, several parcels, bank-claim text supplied, thin evidence).** Code that writes letters implements this document and nothing else. A change to how letters are written is a change to this document first.

---

## 1. Why

### 1.1 What happened

The item-not-received letter reached the maintainer's bar (Blume #352543 v13, #360980). The first not-as-described letter on the same pipeline was a list of records (Mein Maison #101111, 2026-09-28). The advocacy had never been in the pipeline. It lived in one prompt written for non-receipt (`SUMMARY_SYSTEM`, `counsel/prompts.ts:30`). The not-as-described prompt (`prompts.ts:79`) was written from scratch, kept the rules and lost the method. Section text is fixed code per type (`recordSections.ts`) that reports and never argues.

### 1.2 Every place that tells the writer something today

Inventory, 2026-09-28. `rg -l "promptBody|overlayPromptBody|SUMMARY_SYSTEM|BASE_SYSTEM_PROMPT" lib` lists 45 files; the rows below add the non-prompt sources the critic found.

| Source | Where | Type-specific |
|---|---|---|
| Template base prompt (retired) | `narrativeWriter.ts` | — |
| Family overlays and ban lists (9) | `reasonCodes/families/*` | yes |
| Reason-code prompt modules (8) | `reasonCodes/*.ts` | yes |
| Strategy prompts (25) | `strategies/*.ts` | yes |
| Payment overlays | `paymentOverlays.ts` | per method |
| Database overrides | `defence_prompt_modules`, read at `buildDefencePackageJob.ts:331` | yes, invisible in review |
| Counsel system prompts (2) | `counsel/prompts.ts` `SUMMARY_SYSTEM`, `SUMMARY_SYSTEM_NOT_AS_DESCRIBED` | yes |
| Counsel user prompt | `summaryUserPrompt` branches on `familyKey`; carries INR method (WHOLE ORDER, PARCELS) | yes |
| Default theory | `recordSections.ts:26-30` `DEFAULT_THEORY`, INR wording, used by any playbook | yes |
| Code-written sections (3 builders) | `recordSections.ts` | yes |
| Truth validator | `counsel/checks.ts:263` dispatches on two families; every other type is checked against item-not-received bans | yes |
| Type rules inside checks and ledgers | `checks.ts:216-219` (no returns in a NAD summary), `notAsDescribedLedger.ts:150` | yes |
| PDF thesis boxes | `pdf/thesisTemplates.ts`: family-keyed opening lines and the conclusion's "reversal of the chargeback" (patched for non-card at `buildDefencePackageJob.ts:1121`) | yes |
| Section slots and titles | `render/sections.ts` `SECTION_TITLES`; `EvidenceSectionKey` = shipping, lineItems, chronology | fixed to INR |
| Writer gate | `buildDefencePackageJob.ts:599` skips counsel when a bank claim exists | — |

### 1.3 The rule

**One writer. The method is written once. A dispute type contributes facts and a question, never method, wording or checks.**

## 2. Architecture

```
records ──▶ CLAIM LIBRARY (code) ──▶ ledger: the only facts, each with canonical wording and limits
type    ──▶ BRIEF (data only)     ──▶ question, claim tuples, exhibits, limits
payment/stage ──▶ FRAME (code)    ──▶ names, decider, request, page title
                         │
                         ▼
          THE WRITER — one constitution, one output shape, every type
                         ▼
   ONE VALIDATOR (family-free) ─▶ ONE REVIEW ─▶ PDF (one layout; no thesis prose)
                         │
                   ONE JUDGE (offline gate)
```

### 2.1 The constitution

One system prompt, `lib/defence/counsel/constitution.ts`, static and cached. Outside its examples block it names no dispute type, payment method or stage (a unit test pins this).

1. **Role.** The merchant's counsel. Third person, English only, to win.
2. **Reader.** The decider named in the frame (issuer analyst, PayPal, Klarna), two minutes, decides from the summary.
3. **Method** (counsel standard, `docs/plans/defence-counsel/02-counsel-standard.md`, binding):
   - theory of the case as a story;
   - punchline first (the claim against the record, one specific);
   - narrow the question, then answer it;
   - each section says what its exhibit proves for this claim;
   - contrast; third parties as subject;
   - let facts imply what may not be said.
4. **Register.** Plain literal English, short sentences for the blows, no metaphor, throat-clearing, adjective-for-evidence or disclaimer.
5. **Truth.** Only ledger claims, inside each claim's limits, the brief's limits and the universal limits (§4).
6. **Copy.** Each fact once in the whole document (summary, sections, conclusion counted together); never a printed identifier; never a carrier or product name in prose.
7. **Canonical sentences, capped.** Only a claim whose wording scopes or limits truth may carry pinned wording (the approved multi-parcel scope, the whole-order statement): at most five in the library, each added in its own PR. When the writer cites such a claim, its canonical sentence must appear as a substring (code check). Pinned wording never argues; the writer argues around it.
8. **Output.** Summary (≤ 80 words, ends with the frame's request), for each brief section either an argument (1–3 sentences) or nothing when the section is marked exhibit-only, and the conclusion (the theory in one sentence), each part with the claim ids it rests on.
9. **Examples.** Three invented letters from three dispute types and two providers, so the method is learned as a method. Their influence is tested (§6: held-out type and ablation), because examples carry method more strongly than rules.

Why model-written sections, not code sentences: code sentences report a record and cannot argue (the #101111 test print). Truth-critical wording stays pinned per claim (7), so the approved INR sentences survive where they state a fact.

### 2.2 The claim library

`lib/defence/counsel/claims/`. One builder per claim; every type uses the same one. Each claim specifies:

| Field | Meaning |
|---|---|
| `id`, `statement` | the true sentence |
| `canonical?` | pinned wording the writer must use verbatim (optional) |
| `specifics` | the only dates and numbers the letter may print for it |
| `record` | the source (Shopify field, pack section, API read, snapshot, merchant input) |
| `condition` | when it is built |
| `limits` | private limits, sent to the model and the checker |
| `exhibit?` | the exhibit it rests on, printed whenever the claim is used |
| `kind` | `fact` (from a record) or `absence` (a recorded absence; §4.1) or `merchant` (merchant-declared; §2.2.2) |

#### 2.2.1 Claims that need specifying (critic M5)

- **Listing** (`listing_on_file`). The caption says "Product listing as published in the store, retrieved {date}" and nothing more. `Product.updatedAt` is never printed or called an edit: Shopify moves it for reasons other than edits (e.g. inventory adjustments), so it proves nothing about the content.
  - Default wording: neutral only — "the store's listing for the item is reproduced here". The listing is **never argued as the standard the claim is measured against**.
  - It may be argued as the description the item was sold under only when its content is known to predate the order: an order-time snapshot, or an earlier snapshot of the same product with the same `content_hash` taken before the order.
  - **Order-time listing snapshots** (captured at orders ingest) are added to the evidence plans. They are what lifts not-as-described letters above today's ceiling.
- **Refund-policy terms** (`return_route`, `return_window_days`). Extracted once per policy snapshot by a model call into a fixed schema (`{ returnsOffered, windowDays, windowStartsAt: delivery|order, refundAfterReceiptDays, noticeRequired, returnPostage: buyer|merchant|unstated, restockingFee }`). Cached per snapshot; the extraction prompt is versioned inside the §2.7 hash.
  - **Every field carries the source sentence it came from**, and code confirms that sentence is in the policy text. Every number must appear in that sentence.
  - `windowStartsAt` is cross-checked with a keyword test in the policy's language (delivery: "Lieferung", "livraison", "entrega", "leverans", "delivery", "receipt of the goods"…). When a field is ambiguous, the claim is not built.
  - **Dating:** the policy has the listing's problem. The claim says "the store's published policy" only; it is argued as the policy in force at the sale only when its content is known to predate the order (an earlier snapshot with the same content hash, or `ShopPolicy.updatedAt` before the order once verified reliable — open question §12).
  - Unit tests cover extraction on policy fixtures in all six locales.
  - **Whole or none.** The merchant-counsel stance (`merchant-counsel-stance.plan.md` rules 2 and 4) is binding: material that helps the customer never enters any bank artifact. A policy is judged per case, whole: if **any** clause helps the customer on these facts, neither the policy claim nor the policy exhibit appears (omission, never redaction). If none does, the claim may be used and the full text prints. A policy is never partly quoted.
  - **The helps/hurts judgement is deterministic:** rules over the extracted policy fields and the case facts (provider, stage, window open or closed at the dispute date), recorded as the claim's build condition. It is never a model's opinion.
  - **Not as described: D9 decides** whether a return-conditioned "refund for any reason" policy helps or hurts. The stance's table lists "policy clauses granting refunds for defects or 'not as described'" as harmful; until the maintainer rules otherwise, such a policy is **not used** in not-as-described letters.
  - Prose states the policy's effect only as far as it holds with its conditions: "offers a refund on a return made within 14 days of delivery", never "refunds any purchase".
  - The claim is not built when the window had closed at the dispute date.
  - **A policy exhibit** (text plus English translation) prints whenever a policy claim is used. The letter never argues from a document the reader cannot see.
- **Recorded absences** (`no_return_recorded`, `no_refund_request_on_record`): see §4.1.

#### 2.2.2 Merchant-declared claims (open question → D7)

Some strong facts are the merchant's own acts. A `merchant` claim:
- states only something the merchant did ("The merchant offered the customer a return on 20 September"), never anything about the customer's response or choice (§4);
- is built only from a merchant confirmation in the app **with its evidence** (e.g. the sent email), and prints that evidence as an exhibit, or is not used;
- is never combined with a record claim in one sentence.

### 2.3 The brief — data only

`lib/defence/counsel/briefs/<type>.ts`. A unit test fails on imperative or instructional wording in any field except `limits` (Lead, Say, Never, Open with, Do not, …).

| Field | Shape |
|---|---|
| `type` | reason family key |
| `question` | per provider: `{ card, paypal, klarna }`, each with its reference (Visa DMG section, PayPal SNAD/INR, Klarna category) |
| `claims` | claim ids this type may use |
| `theories` | ordered `{ name, claimIds[] }`; no verbs |
| `ceilingClaims` | the claims that lift this type above its evidence ceiling (not as described: complaint text, an order-time listing, a merchant act with evidence). A case is ceiling-limited only when its ledger holds none of them. |
| `minimumClaims` | the claims without which this brief does not apply; below it the **general** brief's strongest theory is used, never another type's (critic M9) |
| `sections` | ordered `{ slot, title, exhibit, claimIds, question, exhibitOnly? }` — `question` is what the section answers, not an instruction; `exhibitOnly` prints the exhibit with its caption and no prose when no ledger claim for it can be argued (e.g. a listing not known to predate the order) |
| `limits` | short truth rules (what may not be claimed), sent to the model as data and compiled into checks. A limit may only forbid a statement, including scoping phrased as a prohibition ("never 'delivered' of a parcel without a delivery record"); a limit that orders, leads or frames ("lead with…", "open by…", "emphasise…") fails the brief test. Positive truth scoping lives only in canonical sentences (§2.1.7). `question` and `title` are limited to 12 words and checked the same way. |
| `references` | the network or provider guidance |

Section slots map onto the PDF's existing narrative slots; titles come from the brief, not `SECTION_TITLES`.

### 2.4 The frame

`lib/defence/counsel/frame.ts` (built): names, page title, case table, request, refused words. It gains `decider` (issuer analyst / PayPal / Klarna) for the constitution and the judge persona (critic M8).

### 2.5 One validator, one review

- **Family-free validator.** The universal checks plus the brief's compiled `limits`. `checks.ts:263`'s two-family dispatch and the type rules at `checks.ts:216-219` and `notAsDescribedLedger.ts:150` are removed.
- **Whitelist.** Every sentence cites claim ids; a sentence that maps to no permitted claim is refused.
- **Repeat check** across all model-written text, not only when the summary is involved (critic M6).
- **Absence and conduct lint** (§4.1).
- **One review call over the whole letter**, one prompt, persona from the frame.

### 2.6 The PDF carries no letter prose of its own

Thesis boxes are suppressed for every writer-written section (`thesisTemplates.ts`, `renderThesis.ts`). The only code-written prose left is the frame's request line and exhibit captions. A CI invariant fails any `familyKey` branch in `lib/defence/counsel/**` or `lib/defence/pdf/**` outside `briefs/` and `claims/`.

### 2.7 Versioning and reuse

- The input hash covers the constitution, the brief, the claim library and the checks, each versioned. A change to any of them bumps its version in the same commit, pinned by a CI test like `compositionVersionBump.test.ts`.
- Reuse stores and re-checks every model-written part (summary, sections, conclusion), not just the summary.

### 2.8 Every dispute reaches the writer

- **Bank-claim cases reach the writer** (critic B1). The writer never receives the claim text. It receives the code classification from `bankClaimAnalysis` (the issue category and the facts it scoped with `scopeFactsToBankClaim`) as the claim `bank_claim_issue`, which selects the brief's question and theory. The never-quote, never-paraphrase rule stays a universal limit. The `!bankClaim?.text` bypass (`buildDefencePackageJob.ts:599`) is removed **in step 1**, gated by the constructed bank-claim reference case.
- **Every type has a brief from day one.** The `general` brief ships with the constitution in step 1: the strongest theory the ledger supports, for any type without its own brief (critic B2).

## 3. The letter — one shape

| Part | Written by | Job |
|---|---|---|
| Header, case table | code (frame) | the proceeding and the facts of record |
| Executive summary | writer | the whole case: punchline, reasons in order of force, request |
| One section per brief section | writer | what that exhibit proves for this claim |
| Exhibits | code | shipment card, line items, listing (+ translation), policy (+ translation), later order, addresses, as the ledger uses them |
| Chronology | code | the complete sequence for every type, including the dispute-opened row; a return/refund row when a record exists |
| Conclusion | writer | the theory in one sentence |
| Request | code (frame) | printed after the conclusion; the summary also ends with it (deliberate, as in the approved #352543) |

## 4. Universal limits

- Only ledger claims, inside their limits.
- Never where a parcel was delivered or that an address matched, unless a claim built from the record says so.
- Never that the customer received, kept, has or used the goods.
- Never the customer's thoughts, knowledge, intent, honesty, motive **or choices**.
- Never lateness under network rules.
- Never a printed limit, weakness or disclaimer.
- Never "independent" or "corroborating" for one record.
- No red-flag adjectives.
- Never a harmful fact or adverse term (merchant-counsel stance). Every sentence true: omission, never misstatement.
- Never quote or paraphrase bank-claim text.

### 4.1 The absence rule (D1, made enforceable)

- **Allowed:** a recorded absence stated in the record's words, at most once per letter ("No return has been recorded in Shopify for this order.").
- **Not allowed:**
  - a recorded absence in the same sentence as a timing clause;
  - a recorded absence made the subject of a sentence about the customer's choice.
- **Lint:** instead, rather than, without first, chose, opted, bypass(ed), skipped, never tried, did not (return|contact|complain) — refused anywhere in model text.

## 5. Every dispute type, one writer

| Type | Question (card / PayPal / Klarna) | Theories (claim tuples, order of force) |
|---|---|---|
| Item not received | Was the order delivered, and all of it? / INR: was it delivered? / Klarna: goods not received | delivered + later order; delivered + notice same day + dispute after; whole order in one parcel; parcels |
| Not as described | Did the item differ from its description? / SNAD / faulty or not as described | delivered + dispute after delivery + listing (neutral); with an order-time listing: sold under that listing + delivered; the return-route tuple only if D9 = helps |
| Credit not processed | Was a refund due and not given? | refund issued; no return received + policy; credit already issued |
| Fraud / unauthorized | Did the cardholder authorise and receive it? | 3-D Secure authenticated (only with merchant confirmation, `tdsVerified`, per CLAUDE.md); returning customer with same payment details + delivered; AVS/CVV match + delivered |
| Subscription cancelled | Was the charge inside the agreed terms? | terms accepted + charge before cancellation on record; service used after |
| Duplicate / incorrect amount | Charged once, at the agreed price? | distinct orders; amount matches order |
| General / any without a brief | What does the record show about this sale? | First routes on `bank_claim_issue` or the network reason code to the matching brief. Otherwise only type-neutral tuples: timing, the customer's later order, the order record. Payment authentication belongs to the fraud brief, never to general. |

**Evidence ceiling, stated plainly.** A not-as-described case without the complaint text and without a positive contradicting fact cannot reach the bar that a delivered-then-reordered non-receipt case reaches. The writer makes the strongest true case; it cannot manufacture a winning one. The claims that raise that ceiling are:
- the bank-claim text (answer the actual complaint);
- merchant-declared acts with evidence (D7);
- customer messages;
- order-time listing and policy snapshots.

The general brief has no specific claim to contrast against, so its summary cannot carry the claim-versus-record punchline; its ceiling is lower still, and that is accepted.

Whole-or-none (§2.2.1) will drop most refund policies from most not-as-described and credit letters, because nearly every refund policy grants the customer something. That is the merchant-counsel stance working as intended, not a defect.

## 6. The gate

1. **Unit tests.**
   - Claim builders, including the listing date flags and policy extraction.
   - The whitelist, the family-free validator and the absence lint.
   - The "no type named outside examples" test.
   - The brief "no instructions" test.
   - The CI `familyKey` invariant.
2. **Reference cases.** 3 per type, spanning providers; open or closed, outcomes recorded when known.
   - Item not received: #352543, #360980 (Blume, card), #103052 (Mein Maison, PayPal).
   - Not as described: #101111, #99445, #93670 (Mein Maison).
   - Bank claim: one constructed case on dev (production holds no bank-claim text today), in the step-1 gate.
   - Credit not processed: Cay #14619 (Klarna) — needed in step 1 for the method-transfer test.
   - Fraud, subscription and general: named in step 3.
3. **Judge, pinned.** Model `claude-opus-5-5`, one rubric, persona from the frame's decider, 5 runs per case. Scores: the five rubric scores summed (5–25) and the decision after the summary. A judge model change re-measures every baseline before any comparison.
4. **Baselines first.** #352543 v13 and #360980 are measured under this judge before step 1 changes anything; those medians are the bar.
5. **Pass rules.**
   - **Tolerance:** each baseline is judged twice (10 runs); the tolerance is max(1, the difference between the two medians).
   - **Baselines must pass first:** #352543 v13 and #360980 must get "merchant" in at least 4 of 5 runs under the pinned judge; if not, the judge is recalibrated before step 1 starts.
   - **Standard pass:** summary-only "merchant" in at least 4 of 5 runs, and the median within tolerance of the baseline (or ≥ 18 where there is none).
   - **Ceiling-limited pass** (types the §5 ceiling applies to, e.g. not-as-described without complaint text): the letter's median beats its negative control **on the same case** by at least 3 points, with zero truth-diff failures and zero red flags. The maintainer's sign-off stays mandatory.
   - **Minimal-response pass** (merchant-counsel stance §4.3, the minimal verified response): when a case's ledger holds no claim beyond delivery, timing and the neutral listing, the letter passes on zero truth-diff failures, zero red flags, no conduct implication, and the maintainer's sign-off. No score-gap requirement.
   - **Negative controls** (the rejected #101111 test print, rev-4 example E) are scored on their own case only; they never serve as positive references. Every ceiling-limited reference case has a pinned negative control on the same case: its current record-only letter, generated once and frozen.
   - **Recalibration guard:** recalibrating the judge is a rubric change the maintainer approves, never tuning to pass a particular letter; the negative controls are re-verified after every recalibration.
   - The rubric adds: "any sentence that implies what the customer did or chose".
   - Truth diff: zero claims the ledger does not hold.
6. **Type independence, tested directly.**
   - **Method transfer (the maintainer's demand):** the credit brief is written as data only, with no credit example in the constitution and no prompt change; its reference case must meet the pass rule. Its data lands in step 1; its release stays in step 3.
   - **General brief as safety net:** a held-out case through the general brief must have zero truth-diff failures, zero red flags and a median ≥ 15. No merchant-decision requirement.
   - **Ablation:** removing any one example from the constitution must not lower any type's median by more than the tolerance.
7. **One test print per (type × provider)** to the maintainer, through the job path. "This is excellent counsel" is the only sign-off.

## 7. What retires

| Retires | Replaced by |
|---|---|
| `SUMMARY_SYSTEM`, `SUMMARY_SYSTEM_NOT_AS_DESCRIBED`, the `summaryUserPrompt` branches | constitution + brief data in the user message |
| `recordSections.ts` builders, `DEFAULT_THEORY` | writer-argued sections; pinned canonical sentences; the general brief |
| Family overlays, reason-code prompt modules, 25 strategy prompts | briefs (network knowledge moves into `question`, `theories`, `limits`) |
| Two-family truth dispatch and type rules in checks and ledgers | family-free validator + brief `limits` |
| Thesis boxes on writer-written sections | nothing |
| `SECTION_TITLES` for writer sections | brief `sections[].title` |
| `defence_prompt_modules` as a live source | the brief in code; the table becomes read-only history (D3) |
| The bank-claim bypass | `bank_claim_issue` claim |
| `counsel/playbooks.ts` | briefs |
| `paymentOverlays.ts` | the frame (names, refused words) and brief `limits` |
| Family `prohibitedBankPhrases` / `guardedBankPhrases` | sorted, phrase by phrase: truth content becomes universal limits or claim limits; type wording goes with its brief; nothing is dropped without a home |

Rollback: the current counsel path stays behind a flag until step 1 passes the gate.

## 8. Decisions for the maintainer

- **D1 — absence rule** as §4.1. Recommended: yes.
- **D2 — model.** Sonnet 4.6 vs Opus 5.5 on the reference cases. The judge is Opus 5.5, which may favour its own writing, so D2 is decided on the maintainer's test prints as well as the judge, within the D4 cost ceiling.
- **D3 — retire the database overrides.** Recommended: yes.
- **D4 — cost ceiling:** measured on the step-1 reference cases before it is fixed; proposed at most $0.05 per letter on Sonnet, including policy extraction and translation (counsel today about $0.016). Opus 5.5 with a correction round likely exceeds it, so D2 may be settled by D4.
- **D5 — release precondition:** no release while any open dispute's type lacks a brief. The general brief closes this on day one.
- **D6 — the listing:** caption "retrieved {date}" only; neutral wording; argued as the description the item was sold under only when known to predate the order (§2.2.1); order-time snapshots added to the evidence plans. Recommended: yes.
- **D7 — merchant-declared acts** (e.g. "the merchant offered a return on 20 September"): allow them from an in-app confirmation with evidence, stating only the merchant's own act (§2.2.2)? Recommended: yes, as a later step.
- **D9 — decided (maintainer, 2026-09-28): by provider.** Card chargebacks: the return-policy claim may be used (helps). PayPal: not used (PayPal's own process runs the return; verified on PayPal's help pages). Klarna: not used until Klarna's dispute terms are verified. Original question: a "refund for any reason, on return" policy in a not-as-described letter: helps or hurts? *Critic recommendation (round 4): decide by provider.* Card chargebacks: **helps** — Visa 13.3 and Mastercard 4853 treat the cardholder's return as part of the claim, so an open, unused return route answers the network's own question. PayPal and Klarna: **hurts** — their default not-as-described resolution is refund on return, so the clause hands the decider the remedy and undercuts the single request (D8). Either way the absence stays in the record's words, once. Original framing: Helps: the remedy the store offers is a return, it was open when the dispute came, and Shopify records no return. Hurts: it tells the decider the buyer is entitled to a refund, which is PayPal's default SNAD outcome; the merchant-counsel stance lists such clauses as harmful. Until decided: **hurts** (not used). With "hurts", #101111's honest letter is the minimal one — delivered, disputed eight days later, listing reproduced — until an order-time listing, the complaint text or a merchant act with evidence exists.
- **D8 — PayPal not-as-described request.** *Decided (maintainer, 2026-09-28): keep the single request* — "close this dispute in the merchant's favour"; no fallback line offering a refund on return.

Decided today and in force:
- the template writer stays retired;
- store titles may stay in tables and cards;
- a captioned machine translation is acceptable.

## 9. Build order

**Schedule change (maintainer, 2026-09-28): "we shall be in production before [30 September]".** #98483 is a PayPal not-as-described case, so the not-as-described brief joins step 1; step 2 keeps the listing/policy extraction work that D9 makes unnecessary for PayPal.

1. **Constitution, claim library, family-free validator, whole-letter review, versioned hash; briefs for item not received and general; the bank-claim claim and removal of the bypass.**
   - First: baselines under the pinned judge (§6.4).
   - Pass: §6.5 on #352543, #360980, #103052 and the bank-claim case; the method-transfer credit brief passes; the general-brief safety net holds; the ablation holds.
2. **Not-as-described brief:** listing date flags, policy extraction and policy exhibit. Reference cases pass; one test print per provider (PayPal first: #101111).
3. **Credit not processed** (Cay, Klarna), **fraud**, **subscription**, **duplicate** — each: brief → reference cases → test print → release with per-change approval → that type's open disputes, deadline-first.
4. **Retire the old sources** (§7) as each type moves; then remove the rollback flag.

Production: nothing ships before step 1 passes the gate and the maintainer approves the release. PR #915's built pieces are reused, not replaced:
- the frame;
- the filing gate;
- the English checks;
- the listing translation;
- the full chronology;
- non-card routing.

## 10. Relationship to other documents

- **Superseded for how letters are written:** rev 1–4 of this file; `defence-counsel/04-prompt-architecture.md`; the prompt sections of `not-as-described-defence-package.plan.md` and `non-receipt-delivery-evidence.plan.md`.
- **In force, referenced here:**
  - `defence-counsel/02-counsel-standard.md` (the method);
  - `merchant-counsel-stance.plan.md`;
  - the copy rule;
  - the evidence plans, which feed the claim library.

## 11. References

- Visa, *Dispute Management Guidelines for Visa Merchants* (June 2024): §3 "How should I respond?" per condition (13.1, 13.3, 13.6, 13.7, 10.4); §4 compelling evidence; p. 9 evidence in English or translated.
- Visa, *Updates and Clarifications to Dispute Rule Language*.
- Mastercard *Chargeback Guide* 4853 / 4837 / 4841 (via published summaries until the primary guide is read).
- PayPal: responding to INR and SNAD disputes; Seller Protection terms.
- Klarna dispute categories.

## 12. Open questions

- Does PayPal expose the buyer's complaint text on any API? If not, the not-as-described question is answered generically; if so, it becomes a claim.
- For cross-border shipments with an unstated return address or postage, does `return_route` need merchant confirmation (D7) before it is argued?
- Does `ShopPolicy.updatedAt` reliably date policy content (§2.2.1)?
- What changed on the #101111 product on 28 September? (Only relevant if order-time snapshots are not yet available when its letter is regenerated.)

## 13. Critic review record

**Round 1 (rev 4): REVISE; example letter E: REJECT.**

| # | Finding | Rev 5 |
|---|---|---|
| B1 | Bank-claim cases never reach the writer | §2.8: `bank_claim_issue` (category, never text); bypass removed in step 1 |
| B2 | Types without a brief get no letter | §2.8, §9.1: general brief on day one; D5 precondition |
| M1 | Briefs carried prose method | §2.3: data-only schema and test |
| M2 | Hidden type-specific sources (validator dispatch, type rules, `DEFAULT_THEORY`, user-prompt branches, thesis boxes, section titles, DB overrides) | §1.2 inventory; §2.5–2.6; §7 |
| M3 | Gate not measurable; judge uncalibrated | §6: reference cases, negative controls, N ≥ 5, tolerance, persona |
| M4 | Absence rule unenforceable ("instead") | §4.1: rule plus lint |
| M5 | Policy and listing claims not buildable | §2.2.1: extraction schema, adverse-term exclusion, policy exhibit, listing date flags |
| M6 | Reuse, review, repeat check, hash and cost broke with model-written sections | §2.5, §2.7, D4 |
| M7 | INR baseline had no pass criterion | §2.1.7 canonical sentences; §6.5 |
| M8 | The frame lacked the provider's decision rule | §2.4 decider; §2.3 per-provider question |
| M9 | Thin evidence undefined | §2.3 `minimumClaims`; §5 evidence ceiling |
| m1–m6 | Test scoping; return/refund row; D2 metric; count source; rollback; double request | §2.1, §3, D2/D4, §1.2, §7, §3 |

**Round 2 (rev 5): REVISE, narrow; letter E2: REVISE (E3 given).**

| # | Finding | Rev 6 |
|---|---|---|
| N1 | General brief and typed examples are back doors for type method; nothing tests independence | §5 type-neutral tuples only; §6.6 held-out type and ablation |
| N2 | D6 would print a likely-false "last edited" caption from `Product.updatedAt` | §2.2.1: never printed; neutral wording; order-time snapshots; D6 rewritten |
| N3 | Policy extraction checked on numbers only | §2.2.1: source sentence per field, language keyword cross-check, ambiguity = no claim, versioned, six-locale tests |
| N4 | Policy dating; exhibit redaction risk | §2.2.1: dating flags; exhibits print full text |
| N5 | Canonical sentences could recreate code listing | §2.1.7: scoping/limiting only, cap 5, substring check |
| N6 | Cost ceiling realism | D4 measured first; D2 may be settled by it |
| N7 | Merchant claims conflicted with the choice ban | §2.2.2: merchant's own acts only, with evidence |
| N8 | Unnamed PayPal INR case; no bank-claim case; general brief punchline | §6.2 names #103052 and a constructed bank-claim case; §5 ceiling note |
| B1 rest | Bank claim sequenced after the gate; text vs category unclear | §2.8: category only; in step 1 |
| M1 rest | `limits`, `question`, `title` could carry method | §2.3: limits may only forbid; length and wording tests |
| M2 rest | `playbooks.ts`, `paymentOverlays.ts`, bank-phrase lists without a home | §7 rows |
| M3 rest | No tolerance; baseline unmeasured; judge unpinned; "or flagged" | §6.3–6.5: numbers, pinned judge, baselines first |
| Letter | Section-level exhibit-only | §2.3 `exhibitOnly`; §2.1.8 |

**Round 3 (rev 6): REVISE, narrow; letter E3: fileable only if D9 = helps.**

| # | Finding | Rev 7 |
|---|---|---|
| D-1 | "Exhibits always print adverse terms" contradicts the binding merchant-counsel stance | §2.2.1 whole-or-none per case; D9; §5 not-as-described theories conditional |
| D-2 | Held-out credit case through the general brief cannot measure type independence | §6.6 method transfer (credit brief as data, no example) + general safety net |
| D-3 | Pass numbers inconsistent with the evidence ceiling; #101111 both positive and negative | §6.5 calibrated tolerance, baselines must pass, ceiling-limited score-gap rule, controls on own case only; D2 also on test prints |
| D-4 | 3-D Secure in the general tuples, unconditioned | §5: fraud only, `tdsVerified`; general routes on bank-claim issue or reason code first |
| D-5 | "Limits may only forbid" vs positive scoping | §2.3: prohibition phrasing; positive scoping only in canonical sentences |
| D-6 | Stale `bank_claim_stated` | fixed |

**Acceptance tests the build carries (critic round 3):**
T1 constitution names no type/provider/stage outside examples · T2 brief test (no imperatives; limits only forbid; ≤ 12-word question/title) · T3 CI `familyKey` invariant over `counsel/**`, `pdf/**` · T4 no imports left of the retired sources · T5 listing caption never contains `updatedAt`; neutral wording unless it predates the order · T6 policy extraction on six-locale fixtures (source sentence, numbers inside it, ambiguity = no claim) · T7 a policy with any helping clause = no claim and no exhibit; a built claim prints the full text · T8 absence/conduct lint and once-per-letter rule · T9 no 3-D Secure claim without `tdsVerified` · T10 bank-claim case: no bank-claim text in the writer's input · T11 reuse re-checks every part; hash changes with any versioned input · T12 baselines measured twice, tolerance from their spread · T13 negative controls ≥ 3 points below positives on the same case · T14 method transfer passes; ablation holds · T15 cost per letter ≤ D4 · T16 one maintainer test print per (type × provider).

**Round 4 (rev 7): ACCEPT-WITH-RESERVATIONS.** D-1 to D-6 all met.

| # | Reservation | Rev 8 |
|---|---|---|
| R1 | With D9 = hurts, #101111's minimal letter could never pass the score-gap rule | §6.5 minimal-response pass |
| R2 | "Ceiling-limited" undefined; two cases without negative controls | §2.3 `ceilingClaims`; §6.5 pinned negative control per case |
| R3 | Credit reference case needed in step 1 but named in step 3 | §6.2 Cay #14619 |
| notes | Recalibration guard; whole-or-none drops most policies; deterministic helps/hurts | §6.5; §5; §2.2.1 |

Added acceptance tests: **T17** a delivery-timing-listing-only ledger passes the minimal-response rule with zero truth-diff and conduct-lint hits · **T18** ceiling-limited only when no `ceilingClaims`; every such case has a pinned negative control · **T19** the credit reference case exists before step 1 and the method-transfer test runs on it · **T20** the policy helps/hurts decision is deterministic: same fields, same decision.

**Letter E findings, fixed in E2:**
- "sold under the description on file" (the listing was edited after the order);
- "instead" and "through it" (conduct by implication);
- "every customer" (a gloss);
- the window and "no return" repeated three times;
- 84 words, not 79;
- arguing from a policy the reader cannot see.
