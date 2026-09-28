# The defence writer — single source of truth

**Status:** rev 4, 2026-09-28. Supersedes rev 1–3 of this file and, for how letters are written, every other writer plan (see §10). For maintainer review.
**Maintainer, 2026-09-28:** *"lift this up to a higher level now so that we work with one single source of truth when it comes to the writer, because we want advocacy and we want our writer to be independent of what type of dispute it is. … now that we slid it over from 'not delivered' to 'a faulty product', you lost it all, but it can't be like that. … It shall affect all dispute types."*

**This document is the single source of truth for how every defence letter is written, for every dispute type, payment method and stage.** Code that writes letters implements this document and nothing else. A change to how letters are written is a change to this document first.

---

## 1. Why a single source of truth

### 1.1 What happened

The item-not-received letter reached the maintainer's standard (Blume #352543, #360980). The first not-as-described letter written on the same pipeline read as a list of records, with no argument (Mein Maison #101111 test print, 2026-09-28). The pipeline did not change; the advocacy did. It was never in the pipeline. It lived in a prompt written for one dispute type:

- `SUMMARY_SYSTEM` (`lib/defence/counsel/prompts.ts`) is the only place the advocacy was ever written down. It carries the reader, the punchline, contrast, register and the examples, and every line of it is about non-receipt.
- For not-as-described, a second prompt was written from scratch (`SUMMARY_SYSTEM_NOT_AS_DESCRIBED`). It kept the rules and lost the method.
- Section text is code-written per dispute type (`recordSections.ts`). Each new type gets new fixed sentences that report and do not argue.

### 1.2 How many places tell the writer what to do today

Measured 2026-09-28:

| Source | Count | Dispute-type specific? |
|---|---|---|
| Template base prompt (`narrativeWriter.ts`, ~280 lines, retired) | 1 | no, but it was transcription, not advocacy |
| Family overlays (`reasonCodes/families/*`: overlay prompts, bans) | 9 | yes |
| Reason-code prompt modules (`reasonCodes/*.ts`) | 8 | yes |
| Strategy prompts (`strategies/*.ts`) | 25 | yes |
| Payment overlays (`paymentOverlays.ts`) | 1 | yes (per method) |
| Database overrides (`defence_prompt_modules`; prod serves these over the code) | per module | yes, and invisible in code review |
| Counsel prompts (`SUMMARY_SYSTEM`, `SUMMARY_SYSTEM_NOT_AS_DESCRIBED`) | 2 | yes |
| Code-written sections (`recordSections.ts`) | 3 builders | yes |

That is about 45 files of instructions, most of them per dispute type, plus a database layer that can silently override the code. The advocacy was written in exactly one of them, so a new dispute type started without it.

### 1.3 The rule this plan sets

**The writer is one thing. The method is written once. Dispute types contribute facts and questions, never method.**

## 2. The architecture

```
                    ┌───────────────────────────────────────────────┐
  records ───────▶  │  CLAIM LIBRARY (code)                         │  facts, each built once from a record
                    │  one definition per claim, shared by all types │
                    └───────────────────────┬───────────────────────┘
                                            │ ledger (the only facts)
  dispute type ──▶  CASE BRIEF (data) ──────┤ question, theories, sections, limits
  payment/stage ──▶ FRAME (code) ───────────┤ names, request, page title
                                            ▼
                    ┌───────────────────────────────────────────────┐
                    │  THE WRITER (one constitution, one model call  │  argues every section
                    │  shape, same for every dispute type)           │
                    └───────────────────────┬───────────────────────┘
                                            ▼
                    VALIDATION (one gate) ──▶ JUDGE (one rubric) ──▶ PDF (one layout)
```

Five components. Each exists once.

### 2.1 The constitution — the writer's one instruction

One system prompt, `lib/defence/counsel/constitution.ts`. **It names no dispute type.** It carries everything that makes a letter advocacy:

1. **Role.** The merchant's counsel. Third person, English only. The job is to win.
2. **Reader.** A dispute analyst (issuer, PayPal or Klarna), two minutes per case, who decides from the summary.
3. **Method** (the counsel standard, `docs/plans/defence-counsel/02-counsel-standard.md`, now binding here):
   - a theory of the case, told as a story;
   - a punchline first: the claim against the record, with one specific;
   - narrow the question the claim turns on, then answer it;
   - every section argues what its exhibit proves for this claim;
   - contrast, and third parties as the subject;
   - let facts imply what may not be said.
4. **Register.** Plain, literal English. Short sentences for the blows. No metaphor, no throat-clearing, no adjective in place of evidence, no disclaimer.
5. **Truth.** Only claims in the ledger. Each claim's private limits bind. The universal truth limits (§4) bind.
6. **Copy.** Every fact once in the document. Never an identifier the page prints. Never a carrier or product name in prose.
7. **Output.** Summary, one argument per section the brief lists, and the conclusion, each with the claim ids it rests on.
8. **Examples.** Three worked letters from **three different dispute types** (invented cases), so the method is learned as a method, not as one claim type's wording.

The case brief, the ledger, the frame and the page context reach the writer in the user message. The constitution is static, so it is cached and costs the same for every type.

### 2.2 The claim library — every fact defined once

`lib/defence/counsel/claims/`. One builder per claim, used by every dispute type that needs it. A claim is a true sentence, the specifics it may use, its sources, and its private limits. It is built only when its record condition holds.

| Group | Claims |
|---|---|
| Order and payment | order placed, paid, payment method, 3-D Secure authenticated (liability shift), AVS/CVV match, customer tenure, prior undisputed orders |
| Fulfilment | shipped, whole order in one shipment, parcels, carrier delivered, signed for, carrier is a third party, delivery notice sent |
| Dispute timing | dispute opened, days after delivery, delivered after the dispute opened |
| Customer conduct on record | later order, same payment details, messages (Gorgias) |
| What was sold | listing published (with translation), variant ordered |
| Policies and returns | refund policy published (return route), return window, no return recorded, refund issued, credit already issued |
| Services and subscriptions | terms accepted, service used after the date disputed, cancellation record |

Today these are scattered across `claimLedger.ts` and `notAsDescribedLedger.ts`, and some are built twice with different wording. They move into the library with one wording each.

### 2.3 The case brief — what a dispute type contributes, as data only

`lib/defence/counsel/briefs/<type>.ts`, one per dispute type. **A brief contains no prose instructions to the model and no section text.** Its fields:

| Field | Meaning | Example (not as described) |
|---|---|---|
| `question` | What the claim turns on, as the analyst asks it; sourced from the network guides | "Was the item different from what was advertised?" |
| `claims` | Which library claims this type may use | listing published, carrier delivered, dispute after delivery, return route, no return recorded, later order |
| `theories` | Stories in order of force, each naming the claims it needs | "Sold under the listing on file → delivered → the store's return route unused → disputed n days later" |
| `sections` | The exhibits this type shows, in order, and the job each section's argument must do | "What was sold: the question is answered by the advertisement, shown here" |
| `limits` | Truth limits specific to this type, as short rules | "Never say the item matched the listing" |
| `references` | The network guidance the brief is built from | Visa DMG 13.3 pp. 40–41; Mastercard 4853; PayPal SNAD |

Adding a dispute type means writing one brief and, if needed, adding claims to the library. It never means writing a prompt.

### 2.4 The frame — payment method and stage

`lib/defence/counsel/frame.ts` (built). It sets the proceeding's name, the page title, the request and the case table for card, PayPal and Klarna, for chargebacks and inquiries. It applies to every dispute type.

### 2.5 Validation and judgement — one gate for all types

- **Whitelist.** Every sentence cites ledger claim ids; a sentence that maps to no permitted claim is refused.
- **Universal checks** (one list): grounding of dates and numbers, copy rules, English only, the frame's words, the lint, and the universal truth limits.
- **Brief checks.** The brief's `limits`, compiled to patterns in the same checker.
- **Review.** One model review call, the same prompt for every type.
- **Judge** (offline): one issuer-analyst rubric for every type (§6).

## 3. The letter — one shape for every dispute

| Part | Written by | What it does |
|---|---|---|
| Header, case table | code (frame) | Names the proceeding; the facts of record |
| Executive summary | writer | The whole case: punchline, reasons in order of force, request; ≤ 80 words |
| One section per brief exhibit | writer | What this exhibit proves for this claim, 1–3 sentences |
| Chronology | code | The complete sequence for every type: ordered → paid → shipped → delivered → dispute opened → return or refund state |
| Conclusion | writer | The theory in one sentence |
| Request | code (frame) | One request, the frame's wording |

The layout (numbered sections, cards, exhibits) stays as the maintainer approved it. Only what fills it changes.

## 4. Universal truth limits

These apply to every letter:

- Only ledger claims.
- Never where a parcel was delivered or that an address matched, unless a claim built from the record says so.
- Never that the customer personally received, kept, has or used the goods.
- Never the customer's thoughts, knowledge, intent, honesty or motive.
- Never "the claim is late under network rules".
- Never print a limit, weakness or disclaimer.
- Never "independent" or "corroborating" for one record.
- No red-flag adjectives ("irrefutable", "baseless", …).
- Never a harmful fact, including the merchant's own adverse policy terms (merchant-counsel stance). Every sentence true; omission, never misstatement.

**Absence rule (decision D1, §8).** A claim may state what a record shows as absent, in the record's words ("No return has been recorded in Shopify for this order"). It never states that the customer did not do something.

## 5. Every dispute type on the one writer

| Dispute type | Question (from the network guides) | Lead theory |
|---|---|---|
| Item not received | Was the order delivered, and all of it? | The carrier recorded delivery; the customer came back or the dispute came weeks later |
| Not as described / defective | Was the item different from what was advertised? | Sold under the listing on file, delivered, the return route unused, disputed n days later |
| Credit not processed | Was a refund due and not given? | The refund owed under the store's policy was issued, or no return that would trigger one was received |
| Fraud / unauthorized | Did the cardholder authorise and receive it? | 3-D Secure authenticated; a returning customer with the same payment details; delivered |
| Subscription cancelled | Was the charge within the agreed terms? | Terms accepted; the charge preceded any cancellation on record |
| Duplicate / incorrect amount | Was it charged once, at the agreed price? | Each charge is a distinct order; the amount matches the order |
| General / unrecognised | What does the record show about this sale? | The strongest applicable theory from the ledger |

Each row becomes a brief. None becomes a prompt.

## 6. The gate — one bar for every dispute type

1. **Unit tests.** Claim builders, the whitelist and the checks. A test pins that the constitution names no dispute type.
2. **One eval set across all types.** Closed disputes with known outcomes, at least 3 per type: #352543 and #360980 (item not received), #101111 (not as described), plus credit, fraud and subscription cases.
3. **One judge rubric.** The issuer-analyst judge must:
   - decide for the merchant after the summary alone;
   - restate a theory of the case matching the brief;
   - find no sentence the ledger does not back;
   - name no section whose deletion would not weaken the letter;
   - report zero red flags.
4. **Regression rule.** A change to the constitution, the library or the checks must not lower any type's scores. The two approved item-not-received letters are the fixed baseline.
5. **One test print per dispute type** to the maintainer, through the job path, before that type's open disputes are regenerated. "This is excellent counsel" is the only sign-off.

## 7. What retires

| Retires | Replaced by |
|---|---|
| `SUMMARY_SYSTEM`, `SUMMARY_SYSTEM_NOT_AS_DESCRIBED` | the constitution |
| `recordSections.ts` fixed sentences | writer-argued sections |
| Family overlay prompts, reason-code prompt modules, 25 strategy prompts | briefs (their network knowledge moves into `question`, `theories` and `limits`) |
| `defence_prompt_modules` database overrides of prompt text and allow-lists | nothing: the brief in code is the only source; the table becomes read-only history |
| Family ban lists | brief `limits` plus the universal checks |
| The template writer | already retired (develop) |

## 8. Decisions for the maintainer

- **D1 — the absence rule (§4).** May a claim state a recorded absence in the record's words (no return recorded, no refund requested on record), never as something the customer failed to do? Visa's 13.3 guidance names "the cardholder never attempted to return" as a response. **Recommended: yes.**
- **D2 — the model.** Sonnet 4.6 today. Compare it with Opus 5.5 on the one eval set; choose on judge score per cent of cost.
- **D3 — the database overrides.** Retire `defence_prompt_modules` as a live source (§7), so code review sees everything the writer is told. **Recommended: yes.**

Decided earlier today and still in force:
- The template writer stays retired (option A after a test print).
- Store titles may stay in tables and cards.
- A machine translation of a non-English listing, captioned, is acceptable.

## 9. Build order

1. **The constitution and the claim library, on the item-not-received brief first.** It must reproduce the approved #352543 / #360980 quality on the eval set; that proves the method moved out of the type-specific prompt intact.
2. **The not-as-described brief.** The eval set, then one test print of #101111.
3. **Credit not processed, fraud, then the rest,** each: brief → eval → one test print → release (per-change approval) → that type's open disputes, deadline-first.
4. **Retire the old sources** (§7) as each type moves.

Production today: the not-as-described, PayPal/Klarna and filing-gate work sits on develop (PR #915) and is not released. Nothing ships to production before step 1 passes the gate and the maintainer approves the release.

## 10. Relationship to other documents

- **Superseded for how letters are written:** rev 1–3 of this file; `docs/plans/defence-counsel/04-prompt-architecture.md` (item-not-received-only); the prompt sections of `not-as-described-defence-package.plan.md` and `non-receipt-delivery-evidence.plan.md`.
- **Still in force and referenced here:**
  - `docs/plans/defence-counsel/02-counsel-standard.md` (the method, now in the constitution);
  - `merchant-counsel-stance.plan.md` (always defend, bury harmful material);
  - `feedback_letter_copy_each_fact_once` (the copy rule);
  - the evidence plans, which decide what facts exist and feed the claim library.
- **Built and kept** (develop, PR #915):
  - the frame;
  - the filing gate;
  - English checks;
  - listing translation;
  - the full chronology, including the dispute-opened row;
  - non-card routing to counsel.

## 11. References

- Visa, *Dispute Management Guidelines for Visa Merchants* (June 2024): §3 per-condition "How should I respond?" (13.1, 13.3, 13.6, 13.7, 10.4); §4 compelling evidence; p. 9 English or translated evidence.
- Visa, *Updates and Clarifications to Dispute Rule Language*.
- Mastercard *Chargeback Guide*, 4853 / 4837 / 4841 (via published summaries until the primary guide is read).
- PayPal, "How do I respond to 'Item Not Received' and 'Significantly Not As Described' disputes?"; Seller Protection terms.
- Klarna dispute categories (docs.klarna.com, dispute management).
