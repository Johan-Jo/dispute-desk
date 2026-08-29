# Decided disputes — say what happened, and why, instead of "Not yet assessed"

**Status:** PLAN ONLY (v1, 2026-08-28). Not started.
**Deliverable:** on a decided dispute, replace the pre-submission assessment language ("Not yet assessed", "No evidence available.") with **one short sentence** stating what we filed and the likely deciding factor, drawn from our own recorded facts. No link, no modal, no extra card — a text string that sits directly under the existing outcome line in the hero header, and **the same sentence as a paragraph in the won/lost outcome email**. One derivation, two render sites.
**Evidence:** all figures from prod `aokhplydttxtebvbeuzc`, run 2026-08-28. The SQL is written locally and **not yet committed** — §8 lists the files and lands them as the first commit of the Phase-1 branch. Until then no figure here is reproducible from GitHub.

---

## 1. The defect, precisely

Screenshot case — order **#349145**, Mastercard **4837** FRAUDULENT, `normalized_status = lost`, `submission_state = submitted_confirmed`, closed 2026-08-29. The Overview hero shows:

> **Dispute lost** · Outcome: lost (decided on Aug 9, 2026).
> `No action required`
> **Evidence assessment** `Not yet assessed`
> No evidence available.

Those last two lines are **false**. We filed a full defence package on this dispute: `defence_packages` v4, `status='submitted'`, `submitted_at = 2026-08-09 08:10:48+00`, carrying **11 classified facts** including delivery confirmation, AVS/CVV and IP location.

### Two independent defects compound here

**(a) A pre-filing gate asked after the case is over.**

`OverviewTab.tsx:257` → `const assessed = derived.assessment.mayRenderVerdict;` feeds `OverviewTab.tsx:985-988`:

```ts
const strengthKey = !assessed
  ? "not_assessed"
  : presentation?.strength
  ?? (caseStrength.overall === "insufficient" ? "not_assessed" : caseStrength.overall);
```

`mayRenderVerdict` comes from `lib/disputes/assessmentPresence.ts:107-133`, false whenever `needsRecalculation` is true. That gate is **correct and deliberate for a live case** — it refuses to show a strength band, a recommendation, or a filing button against a stale or missing assessment, and its own comment (`:126-128`) says all three must be false together.

**But it is being asked the wrong question on a terminal dispute.** "Is the assessment fresh enough to file against?" is meaningless once the bank has decided: nothing will be re-filed, no button exists to gate, and the snapshot is *supposed* to be stale. The gate answers "not fresh"; the UI mistranslates that into "we never assessed this", then emits forward-looking copy (`disputes.assessmentState.notAssessed.bodyAbsent` — *"It is assessed automatically once the evidence pack is built — nothing is needed from you"*) on a dispute that closed months ago.

**(b) The sentinel's reason string escapes the gate entirely.**

`strengthReasonText` (`useDisputeWorkspace.ts:1120`) is rendered at `OverviewTab.tsx:1003-1007` with **no `assessed` guard**. So the hardcoded `EMPTY_WORKSPACE_STRENGTH` sentinel (`workspaceAssessment.ts:192-204`) prints `disputes.strengthReason.general.insufficient` → **"No evidence available."** — a factual claim contradicted by the submission record.

Diagnostic fingerprint: it renders the **`general`** family string, not the **`fraud`** one (`messages/en.json:758`) that a real scorer run on a 4837 case would produce (`lib/argument/caseStrength.ts:138-140`). That proves the text is sentinel output, not an assessment.

So the UI simultaneously claims it *has not assessed* the case and asserts a *conclusion about the evidence*. Both defects must be fixed; they are not the same bug.

### Why the snapshot is missing — a real linkage gap

The assessment reads **exclusively** from `evidence_packs.pack_json` (`workspace/route.ts:160-166`, `:774-776`). It never reads `defence_packages`, which is queried separately (`:679`, `:687`) and contributes only `plan_json`, itself gated behind `canonicalPipelineEnabled()`.

A dispute can therefore hold 4 submitted `defence_packages` rows while `buildWorkspaceAssessment` sees `snapshot: null`. Three routes to `not_assessed`: no `evidence_packs` row at all (`route.ts:842`); a row whose `pack_json.case_assessment` is absent; or absent `case_assessment_gates`, which makes `currentAssessmentHash` null and substitutes `UNRECONSTRUCTABLE_HASH` (`workspaceAssessment.ts:123,189`) — a value no snapshot can ever match.

**`assessmentPresence.ts` is not the bug and must not be changed.** The caller is.

---

## 2. What Shopify shows that we don't

The Admin page for the same dispute (`.../payments/dispute_evidences/11034656961`) says:

> **The bank sided with Kiera Ferreira** — because the customer details you provided (name, email, phone, billing/shipping address, and IP) didn't match, and the buyer continued to report the purchase as unauthorized.
> `Decision detail` · `Help me understand why I lost`

That is the explanation the merchant wants and we do not offer.

### It is NOT available via API — verified twice, do not plan an ingest

Doc research across Admin GraphQL **2025-10, 2026-01 and `unstable`**: `ShopifyPaymentsDispute` has exactly 12 fields, and the whole machine-readable outcome surface is `status` (`WON`/`LOST`) + `finalizedOn`. There is no `decisionReason`, `outcome`, `verdict` or `decisionDetail` in any version. REST is identical. `ShopifyPaymentsDisputeEvidenceFileType` has 7 values, all merchant-supplied categories — there is no issuer-response type, which is why the Attachment A/B packet is unreachable.

Confirmed live 2026-08-03 against dispute `11017846977`: `disputeFileUploads` returned only our own upload; `node()` on the issuer file GID returned `INTERNAL_SERVER_ERROR`. "Help me understand why I lost" is an Admin-side feature with no API counterpart.

**Therefore the header sentence must stand on our own facts alone.** We cannot quote, paraphrase or fetch Shopify's wording, so the copy never references it and never implies we know what the bank said. What we write is what we observed in the evidence we filed — which, as §3 shows, lands on the same fact anyway.

(The dispute already carries a "View in Shopify Admin" button in the page header, so a merchant who wants Shopify's own wording has a route. This plan adds no second link.)

### One genuine API gap, adjacent but separate

`reasonDetails.networkReasonCode` **exists and is populated** (returned `4853` live) but is never selected — `disputes.ts:20,49` take `reasonDetails { reason }` only. Every stored `network_reason_code` is therefore *inferred* from the coarse enum and can never contradict it; only **40 of 382** losses have one at all. Worth fixing, but it is **not** a rationale substitute: in the verified case the raw code agreed with the enum while the issuer actually decided on delivery proof. Recorded here, out of scope for v1.

---

## 3. What we CAN say from our own data — and it is good

For #349145 our recorded facts line up with Shopify's stated reason almost exactly (`scripts/sql/lost-avs-vs-shopify-card.sql`):

| Field | Our recorded value | Bearing on the loss |
|---|---|---|
| `avs_cvv_match` | **`avsResult: "N"`**, `cvvResult: "M"` | **AVS did not match.** Shopify's card says the address didn't match — the same fact |
| `delivery_proof` | `delivered_confirmed`, **`signedByName: null`** | delivered, but **unsigned** — weak on a 4837 fraud claim |
| `ip_location_check` | `same_country` | coarse; not decisive identity evidence |

So we could have said, truthfully and before the merchant asked:

> The card's billing address did not match the address on the order, and delivery was confirmed but not signed for. On an unauthorized-transaction claim, banks weight address match and signature heavily, so this was the likely deciding factor.

Grounded in stored facts — not a guess, and not a restatement of text we cannot read.

### Coverage — the hard constraint this plan must respect

| Population | Count |
|---|---|
| Lost disputes, all time | **382** |
| …marked `submitted_confirmed` — **we filed** | **367** |
| …retaining a `defence_packages` row | **45** (12.3% of filed) |
| …with classified `facts_json` to reason over | **39** |

**But `submitted_confirmed` does NOT mean DisputeDesk filed it.** This is the trap in the whole dataset, and an earlier draft of this plan fell into it twice. Splitting decided disputes by whether they closed before or after the shop installed (`filed-by-whom.sql`):

| Era | Disputes | Marked `submitted_confirmed` | Has a pack row |
|---|---|---|---|
| **Decided before install** | 451 | **390** | **0** |
| Decided after install | 184 | 159 | **177** |

390 disputes carry `submitted_confirmed` despite closing before the shop ever installed the app. Those are **historical imports** — evidence the merchant (or Shopify) filed on their own, back-filled from Shopify at install. The flag records *that a response was submitted to Shopify*, not *who assembled it*. Disputes here go back to 2023; the earliest shop installed 2026-03.

By quarter (`pack-presence-by-era.sql`), packs appear as a clean switch-on, not a decay: 2026-Q3 → 139 packs / 140 disputes; 2026-Q2 → 61 / 147; **2026-Q1 and everything earlier → 0.** Nothing was deleted. The rows were never created, because we weren't there.

So an earlier framing of this as a "pack retention" problem was wrong — nothing is being lost. **Post-install, coverage is essentially complete: 177 pack rows across 184 decided disputes (96%).**

### Historical disputes ARE classifiable — the order data survived

The 466 historical disputes have no pack, but they are **not** data-less. Joining `disputes.order_gid = shopify_orders.shopify_order_id` (both are full GIDs — do not `split_part` them) gives **100% order linkage** (`historical-signal-availability.sql`):

| Signal | Lost (335) | Won (131) |
|---|---|---|
| Linked order row | **335** | **131** |
| `fulfillment_status`, `financial_status`, `risk_recommendation_initial` | 335 | 131 |
| `payment_method` | 323 | 121 |
| `delivery_status` | 183 | 54 |
| `signed_by_name` | **0** | **0** |
| `three_ds_authenticated` | 5 | 3 |

And the signals **discriminate** (`historical-reason-winrate.sql`):

| Reason | Won | Lost | Win rate |
|---|---|---|---|
| `CREDIT_NOT_PROCESSED` | 38 | 5 | **88%** |
| `PRODUCT_UNACCEPTABLE` | 12 | 14 | 46% |
| `PRODUCT_NOT_RECEIVED` | 33 | 61 | 35% |
| `FRAUDULENT` | 40 | 232 | **15%** |
| `SUBSCRIPTION_CANCELLED` | 1 | 16 | **6%** |

A 6%→88% spread across 466 cases is a genuinely useful base rate, and it is **per-shop computable**. One counter-intuitive result worth keeping: `delivery_status = 'Delivered'` correlates with a **lower** win rate (22%) than no delivery data at all (34%) — almost certainly because delivered-and-still-disputed skews fraud. **Do not turn that into a factor clause**; it is a warning that correlation here is not causation.

**Scope discipline.** This makes historical *aggregate* classification viable (Phase 2, §8) — base rates like "fraud disputes are won 15% of the time on this store". It does **not** make historical *per-case* explanation viable: `signed_by_name` is 0/466 and AVS/CVV are absent entirely, so the §5 clauses cannot be evaluated. A historical case still renders `not_defended_by_us`. The two must not be conflated.

### State resolution

The states key on **whether a pack row exists** — the reliable proxy for "DisputeDesk did this":

- `we_defended_with_facts` — pack row with classified facts. The full sentence with a clause. This is the **normal** case for anything decided post-install.
- `we_defended_no_facts` — pack row, but no usable facts (early post-install packs, or a non-card family like Klarna). We filed; we just have nothing to single out.
- `not_defended_by_us` — **no pack row**, i.e. the ~451 historical imports. Says the dispute was decided before DisputeDesk filed anything, **regardless of `submitted_confirmed`.**

**`submission_state` must not be the gate.** It is true on 390 pre-install disputes and would make the product claim credit for 390 cases it had nothing to do with — the retired `deliveredToVerifiedAddress` class of error, at scale. The presence of a pack row is the honest signal, and it is nearly perfect post-install (96%).

---

## 4. The model — three terminal states, not one

Replace the single lost-hero branch with an explicit resolved state. Each is decided by data we hold; nothing guesses.

```ts
export type OutcomeExplanation =
  | { kind: "we_defended_with_facts";     // 39 cases: package + classified facts
      filedAt: string;
      factors: OutcomeFactor[] }          // ranked, grounded — §5
  | { kind: "we_defended_no_facts";       // pack row, but no usable facts (e.g. Klarna)
      filedAt: string }
  | { kind: "not_defended_by_us";         // 466 historical imports: no pack row
      reason: "pre_install" | "no_package" };
```

**Resolution: the pack row is the gate, not `submission_state`.**

1. **Did DisputeDesk defend this?** — does a `defence_packages` row exist (`status='submitted'`), else an `evidence_packs` row? **No → `not_defended_by_us`.** Do **not** use `submission_state`: §3 shows it is true on 390 pre-install imports and would claim credit for cases we never touched.
2. **Do we have facts to reason over?** — non-empty `facts_json` on that row. Splits the two defended states.

This is the whole resolver. It is deliberately conservative in one direction only: a defended case with a missing row degrades to "not defended by us" rather than inventing work. Post-install that costs us ~4% (177 rows / 184 disputes).

### The header string — exactly what renders

One sentence, placed directly under the existing `hero.subtitle.closedLost` / `closedWon` line ("Outcome: lost (decided on Aug 9, 2026)."). New token namespace `disputes.outcomeExplanation.*`:

| State | Rendered string |
|---|---|
| `we_defended_with_facts` (lost) | "We filed your evidence on {date}. **{clause}** — banks weight this heavily on this type of claim." |
| `we_defended_with_facts` (won) | "We filed your evidence on {date}. **{clause}** — that is usually what carries a case like this." |
| `we_defended_no_facts` (lost) | "We filed your evidence on {date}. The bank still decided for the cardholder." |
| `we_defended_no_facts` (won) | "We filed your evidence on {date}, and the bank ruled in your favour." |
| `not_defended_by_us` | "This dispute was decided before DisputeDesk filed any evidence for it." |

`{clause}` is the **top-ranked factor only** (§5) — one clause, never a list, because this is a header line and not a report. Worked example for #349145:

> Outcome: lost (decided on Aug 9, 2026).
> We filed your evidence on Aug 9, 2026. The card's billing address did not match the address on the order — banks weight this heavily on an unauthorized-transaction claim.

Per-factor clauses, loss side (each a token, all 6 locales); won side in §5:

| Code | Clause |
|---|---|
| `avs_mismatch` | "The card's billing address did not match the address on the order" |
| `no_signature_on_fraud` | "The delivery was confirmed but nobody signed for it" |
| `no_delivery_confirmation` | "No carrier confirmation of delivery ever reached us" |
| `weak_identity_signals` | "The only identity signal we could confirm was the customer's country" |

Length budget: the whole sentence stays **under ~180 characters** so it does not wrap past two lines at 393px. Verified against `feedback_embedded_mobile_design`.

The strength pill is **removed entirely** on terminal disputes, and `strengthReasonText` is **suppressed** there (fixing defect (b) — the ungated sentinel). "Not yet assessed" is a live-case concept; on a closed case there is nothing left to assess and both strings can only mislead.

### The same sentence goes in the outcome email

`lib/email/sendOutcomePostedAlert.ts` fires on `OUTCOME_DETECTED` and today says only:

> "The card network sided with the cardholder, and the disputed amount has been deducted from your payout."

That is the same gap as the header — it states the result and stops. **The §4 sentence is appended as one additional body paragraph**, so the merchant reads the identical explanation in both places. One derivation, two render sites; the email must never say something the Overview doesn't.

Placement: inserted as `body[1]` in the `lost` variant — after the result statement, before the "no further action / review what happened" paragraph, which then reads as the natural follow-on.

**Applies to won as well.** The `won` variant gets the mirror sentence, so the merchant learns what carried the case: *"We filed your evidence on {date}. The delivery was confirmed and signed for — that is usually what carries a case like this."* Won-side factors are the same predicates read positively (`avs_match`, `signature_confirmed`, `delivery_confirmed`).

Constraints specific to this file:

- **Four variant groups × 6 locales.** `lost`, `won`, and their `inquiry.*` counterparts all need the paragraph, in `en`/`es`/`pt`/`fr`/`de`/`sv` — 24 strings, same session (`feedback_translate_on_add`).
- **This file holds hardcoded English by design** — it is outside the `lib/**` I18nToken rule and carries its own `STRINGS: Record<Locale, LocaleStrings>` table. Follow the existing pattern; do **not** import the UI tokens here or refactor the file to `resolveToken`.
- **The `accepted` variant gets nothing.** Its own header comment says it is a catch-all that also reaches disputes we did submit, so it cannot know what was filed. Adding the sentence there would be exactly the false claim §3 forbids.
- **The email must degrade to today's copy** whenever the state is `we_defended_no_facts` or `not_defended_by_us` — no paragraph at all rather than a vaguer one.

---

## 5. `deriveOutcomeFactors` — grounded, ranked, honest about uncertainty

New pure module `lib/disputes/outcomeExplanation.ts`. Input: submitted package `facts_json` + reason family + outcome. Output: ranked factors. The **same predicates** serve both outcomes — read negatively for a loss, positively for a win.

```ts
export interface OutcomeFactor {
  code: FactorCode;              // stable, testable
  token: I18nToken;              // merchant copy — no English in lib/
  confidence: "observed" | "likely";
}
```

Rules, each traceable to a stored fact — all four verified present in prod data:

| Code | Condition | Confidence |
|---|---|---|
| `avs_mismatch` | `avs_cvv_match.avsResult` ∈ non-match set (`N`,`A`,`Z`,`W`,`U`) | `observed` |
| `no_signature_on_fraud` | fraud family AND `delivery_proof.signedByName` null | `observed` |
| `no_delivery_confirmation` | no `delivery_proof` with `delivered_confirmed`/`signature_confirmed` | `observed` |
| `weak_identity_signals` | `ip_location_check.locationMatch` = `same_country` or absent | `likely` |

Won-side, same predicates inverted — clause: *"…that is usually what carries a case like this."*

| Code | Condition | Clause |
|---|---|---|
| `signature_confirmed` | `delivery_proof.signedByName` non-null | "The delivery was confirmed and signed for" |
| `avs_match` | `avsResult` ∈ `{Y, M}` | "The card's billing address matched the address on the order" |
| `delivery_confirmed` | `delivery_proof.proofType = delivered_confirmed` | "The carrier confirmed delivery" |

Ranking on the won side is strongest-first (signature beats bare delivery), so the sentence names the thing that actually did the work.

### Why the won clause rarely fires — a payment-family mismatch, not an absence of wins

An earlier read of this plan said the won corpus was "1 case". **That was a measurement artefact, and the correction matters.** Counting only disputes with a submitted `defence_packages` row hid the actual population. The real shape (`won-corpus-by-shop.sql`, `won-vs-lost-pack-presence.sql`):

| | Won | Lost |
|---|---|---|
| Total | **132** | 382 |
| We filed (`submitted_confirmed`) | **73** | 367 |
| …with a `defence_packages` row | **1** (1.4%) | 45 (12.3%) |
| …with an `evidence_packs` row | 16 | 58 |

So there are **plenty of wins — 132, including 58 won inquiries on cay-collective.** What is missing is not the wins but the *retained pack rows* for them. 73 wins are marked `submitted_confirmed` — we filed on them — yet only 1 kept a defence package. The same erosion hits losses (12.3%); wins are just worse.

Two distinct causes, and they need separating during implementation:

1. **Klarna inquiries.** All 7 cay-collective wins that *do* retain a pack are `payment_context.family = "klarna"`, `klarnaSubProduct: "pay_later"`, `cardNetwork: null`. **Klarna has no card network, so AVS, CVV and signature do not exist on these cases** — the §5 won predicates are structurally inapplicable, not merely unobserved. Klarna needs its own factor vocabulary (see `project_klarna_dispute_handling`), which is out of scope here.
2. **The remaining 124 wins are historical imports** — decided before the shop installed, so no pack was ever built. They resolve to `not_defended_by_us` and never reach the won clause at all.

**Consequence for this plan, unchanged in substance:** the won clause resolves to zero factors on essentially every win today, and §5 rule 2 correctly renders the plain "We filed your evidence on {date}, and the bank ruled in your favour." That is honest and safe. But the *reason* is coverage and payment-family mismatch — **not** that wins are rare or that the predicates are wrong.

Therefore: **ship the won path with the plain sentence; hold the three won clauses until a card-network win with a pack exists to validate them.** Do not tune them against Klarna cases — they cannot apply. This is a wait-for-data situation, not a defect: post-install pack coverage is 96%, so the first card-network win after this ships will produce one.

Non-negotiable discipline:

1. **Never assert causation.** The clause states the observed fact and "banks weight this heavily" — never "you lost because". §2 proves we cannot know the bank's reasoning.
2. **Zero factors is a valid result.** Fall back to the `we_defended_no_facts` string. Do **not** pad with filler.
3. **Merchant-facing only, never bank-facing.** These strings must never reach `narrative_json` or a PDF — naming our own weaknesses to an issuer is the `feedback_bank_optimized_rebuttal` violation. Enforced by test (§7).
4. **No bare gateway codes.** "The billing address did not match" — never "AVS = N" (`feedback_no_bare_gateway_codes_merchant_copy`).
5. **Only the top-ranked factor renders.** Ranking is the table order above (`observed` before `likely`). Lower-ranked factors are derived but unused in v1 — they exist for Phase 2 aggregation.

---

## 6. Affected surface

| Module | Change |
|---|---|
| `lib/disputes/outcomeExplanation.ts` | **NEW** — §4 resolver + §5 derivation, pure. Shared by UI and email |
| `app/(embedded)/app/disputes/[id]/tabs/OverviewTab.tsx:257,985-1007` | terminal branch bypasses `assessed`; drops the strength pill **and** the ungated `strengthReasonText`; renders the §4 sentence |
| `app/api/disputes/[id]/workspace/route.ts` | for terminal disputes, return submitted `defence_packages` (`facts_json`, `version`, `submitted_at`) |
| `lib/email/sendOutcomePostedAlert.ts` | new body paragraph on `lost`/`won` + their `inquiry` variants, all 6 locales; `accepted` untouched |
| `lib/disputes/disputeEffectsDispatcher.ts:406-424` | the effect already queries `disputes` for `order_name` inside the dedup wrapper — extend that read to the submitted `defence_packages` row and pass the resolved explanation into `sendOutcomePostedAlert` |
| `messages/{en,de,es,fr,pt,sv}.json` | new `disputes.outcomeExplanation.*`; all 6 locales same session |
| `lib/disputes/assessmentPresence.ts` | **UNCHANGED** — gate is right, caller was wrong |
| `docs/technical.md` | new § *Lost-dispute explanation* |
| `lib/help/embedded.ts` | help article: what we can and cannot know about a decision |

**Merchant-visible: YES** → `npm run build` required.

---

## 7. Tests

- **The reported bug:** a lost dispute with a submitted package and stale assessment renders **neither** "Not yet assessed" **nor** "No evidence available." — asserted on #349145's exact shape (submitted `defence_packages`, absent `evidence_packs.case_assessment`).
- **State split:** pack + facts → `we_defended_with_facts`; pack, no facts → `we_defended_no_facts`; **no pack → `not_defended_by_us`** even when `submission_state = 'submitted_confirmed'` — the explicit regression for the 390 pre-install imports that carry that flag.
- **Factors:** `avsResult:"N"` → `avs_mismatch`; fraud + `signedByName:null` → `no_signature_on_fraud`; clean case → **empty array**, no filler.
- **Bank-facing isolation:** every `outcomeExplanation` token absent from `narrative_json` and from the rendered PDF (reuse the PDF-extraction method in `mastercard-avs-citation.plan.md` §7).
- **No bare codes:** no rendered string matches `/\bAVS\b|\bCVV\b|\b4837\b/`.
- **Live disputes still gated** by `mayRenderVerdict` — the pre-filing protection is untouched (regression test asserts an open dispute with a stale snapshot still shows no strength band and no filing CTA).
- **Header and email agree:** for a given dispute the sentence rendered in the hero and the paragraph in the email are produced by the same `deriveOutcomeFactors` call and are **string-identical**. This is the test that stops the two drifting apart.
- **Email variants:** `lost` and `won` (and their `inquiry` counterparts) gain the paragraph; **`accepted` does not** — asserted explicitly, since that variant cannot know what was filed.
- **Email degrades:** `we_defended_no_facts` and `not_defended_by_us` produce today's copy with **no** added paragraph.
- **i18n parity** across 6 locales (`scripts/verify-i18n-parity.mjs`), plus the 24 new email strings present in every `STRINGS` locale entry.
- **Length:** the composed header sentence is ≤180 chars for every factor code in every locale.

**Verify:** `npm test`, `npx tsc --noEmit`, `npm run build`.

---

## 8. Sequencing

**Phase 1 — one PR to `develop`.** Commit the evidence SQL first, so every figure here is reproducible at review time:

`lost-avs-vs-shopify-card.sql`, `lost-facts-coverage.sql`, `filed-by-whom.sql`, `pack-presence-by-era.sql`, `won-vs-lost-pack-presence.sql`, `won-corpus-by-shop.sql`, `won-payment-family.sql`, `defended-corpus.sql`, `historical-signal-availability.sql`, `historical-reason-winrate.sql`, `historical-win-loss-signals.sql`.

Then §4 model, §5 derivation, §6 wiring, §7 tests, docs + help article, 6-locale copy.

**Phase 2 — separate approval. Historical win/loss classification, and it is no longer blocked.** The earlier draft said this was blocked on volume by counting only the 45 defended losses. §3 corrects that: **466 historical disputes have 100% order linkage** and their reason codes discriminate 6%→88%. That is enough to compute per-shop, per-reason base rates today, over a corpus 10× the defended one.

Scope for Phase 2, in order:

1. **Base rates from the reason code + order signals** — "on this store, fraud disputes are won 15% of the time; credit-not-processed 88%." Pure aggregate over the historical corpus; no per-case claim, so the §3 honesty constraint is untouched.
2. **Blend in the 45 defended cases** once there are enough to compare *our* win rate against the historical baseline. That comparison is the actual product claim ("we do better than what happened before"), and it needs both corpora to be meaningful.
3. **`reasonDetails { networkReasonCode }`** (§2) — populated on only 40 of 382 losses today because it is never selected. Needed for sub-reason slicing (4837 vs 4853), not for the reason-family base rates above, which work now.

**Two guardrails carried from §3:** never present a historical base rate as a per-case explanation, and do not build factors on `delivery_status` — its correlation runs backwards.

---

## 9. Open questions

1. **Historical emails are not resent.** The paragraph only reaches disputes that decide *after* this ships — `OUTCOME_DETECTED` is dedup-guarded and fires once. The 39 already-decided cases get the new sentence in the Overview header only. Assumed acceptable; flagged because it means the two surfaces disagree on historical cases by design.
2. **`reason_code_module = visa_10_4_fraud` on a Mastercard 4837 case** (all 4 packages for #349145). Pre-existing conflation already flagged in `mastercard-avs-citation.plan.md` §7 — not caused by, and not fixed by, this plan. Recorded because it surfaced in the same data.
