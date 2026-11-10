# Dispute status copy — "done / waiting / next / your move"

**Status:** pending approval (2026-11-10)
**Scope:** merchant-facing status COPY only — the Overview hero paragraph of `app/(embedded)/app/disputes/[id]/record/*`, plus the package card (`pkg.lines`) and the open-dispute timeline steps that reuse the same facts.
**Out of scope (sibling plan, "single source"):** reconnecting `lib/disputes/disputeRecord.ts` to `resolveLifecycle`, `effectiveChecklist`, `refundStatement`, `noReturnApplicability`, the `heldState` offer gates (`canOfferParcelOutcome`, `canOfferCardholderAcknowledgement`), and making "saved" mean Shopify-accepted. Data truth, save/build writers, backfills, filing incidents: all there, none here.
**Supersedes:** the copy half of `docs/plans/dispute-status-explanation.plan.md` (r2).

---

## 0. What is wrong with the copy today (read from code, 2026-11-10)

`ACCOUNT[stage]` (`lib/disputes/disputeRecord.ts:911`) assembles the hero as `claim → reopened → escalated → prepared|saved → … → roles → action`.

| Defect | Where | Example (sv / en) |
|---|---|---|
| Internal build counter shown | `filed.version*`, `prepared.version` | "DisputeDesk sparade **version 9** av försvarspaketet i Shopify den 10 nov." |
| Four role counts as a sentence | `roles.open` / `roles.decided` | "Angivet för banken: 2. Sammanhang i paketet: 6. Hålls internt: 3. Inte tillgängligt: 1." |
| Headline contradicts body | `headline.needs_attention` + `action.ack` | "Needs your attention … No action is required. Adding the cardholder's acknowledgement would strengthen the case." |
| No "next" / "waiting on" in saved & under-review stages | `ACCOUNT.saved = ["saved","roles"]` | merchant cannot tell whether anything is still pending |
| Unconditional future promises | `autopilot`, `held`, `reviewMode.approved` | "DisputeDesk saves it to Shopify on {date}, the deadline" — violates `deadlineOnlyCopy.ts:96-115` ("scheduled, not promised"; P-6 re-evaluated at the deadline) |
| "Saved" ≠ filed in merchant terms | `filed.*`, `headline.saved` | Every save uses `submitEvidence: true` (`composeShopifyMutationPayload.ts:40`) — it IS the filing. "Saved in Shopify" reads like a draft waiting for a button. |
| Inquiry never explained | no token | merchant does not learn an inquiry precedes a chargeback |
| sv term drift | `record.escalated` = "återbetalningskrav"; rest of `disputes.*` uses "chargeback" (34) and "återkrav" (10) | one concept, three words |

---

## 1. RALPLAN-DR (mode: SHORT)

**Principles**
1. **Consume, never compute.** The copy layer maps a resolved account object to tokens. It reads no pack, audit row, `status` string or date to decide a state. If a sentence needs a fact the object lacks, the fact is added to the seam (§2), not derived here.
2. **Four slots, every open state:** *done* (what has happened, with date) · *waiting* (who: you / DisputeDesk / Shopify / the bank / the deadline) · *next* (what happens next, with date when a stored fact backs it) · *action* (the one thing you must do — or an explicit "nothing", only when no required ask exists).
3. **Provable or absent.** No sentence without a backing field. "Scheduled", never "will". No claims about Shopify's own deadline process beyond the undated `deadlineFilingCopy` doctrine sentence. No "we retry automatically", "support has been alerted", "the bank decides within N days".
4. **Name, don't count.** The bank-facing evidence is a named list ("the payment check, the delivery and Shopify's fraud screening"); counts live only on the Evidence tab chips.
5. **One term per concept per locale;** merchant vocabulary only (no version, %, role names, gateway codes, "Shopify automatic response").

**Decision drivers**
1. The merchant reads the hero as the status and today it is either false-sounding ("version 9", counts) or self-contradictory ("needs attention … no action required").
2. The sibling plan is changing the state model under this paragraph — the copy must meet it at one seam or the two will drift again.
3. Rule 8: the paragraph structure came from Claude Design `NewDispute.dc.html` — any deviation needs maintainer sign-off and a recorded design update.

**Options**
- **A. Patch tokens in place** — delete `roles` / `version` from `ACCOUNT`, reword `action.ack`, keep the stage-keyed `ACCOUNT` table. *Pros:* smallest diff, no new types. *Cons:* still no "waiting"/"next" for saved/under_review/failed; `disputeRecord.ts` keeps deciding which sentence applies from `RecordStage`, which the sibling plan is replacing → the copy keeps a private state model.
- **B. Slot composer over the seam object (chosen)** — a pure `composeStatusCopy(account: StatusAccount, fmt)` in `lib/disputes/presentation/statusCopy.ts` returns `{ headline, chip, done, waiting, next, action, inquiry?, bank? }` as `I18nToken`s; `disputeRecord.ts` maps those to `facts`/`account`/`pkg.lines`/timeline. *Pros:* one precedence table; exhaustive `switch` over the seam's stage union makes a new state a compile error; testable over states × locales. *Cons:* blocked on the sibling plan's object; touches ~60 keys × 6 locales.
- **C. LLM-written status summary** — rejected: non-deterministic, unprovable sentences, cost (memory: LLM cost budget before ship).

**Why B:** A leaves the copy deciding state (violates P1 and driver 2). B is the seam.

---

## 2. Hard dependency — the seam

This plan **ships after** the sibling plan exposes the object below (name it whatever that plan chooses; this is the minimum the copy needs). The copy layer imports only this type plus `I18nToken` helpers and `deadlineFilingCopy`.

```ts
/** Produced by the single-source plan. The copy layer reads nothing else. */
interface StatusAccount {
  phase: "inquiry" | "chargeback";
  /** From resolveLifecycle (incl. the new save states). Closed union. */
  stage:
    | "no_pack" | "building" | "build_failed" | "build_paused"      // capped ≠ failed
    | "ready"                                                       // built, auto, filing now/queued
    | "awaiting_approval" | "approved_scheduled" | "not_adding"     // review mode; not_adding = merchant conceded
    | "held_for_deadline" | "withheld_no_safe_argument"
    | "saving" | "save_failed" | "accepted_by_shopify" | "sent_to_bank"
    | "covered" | "fatal" | "decided";
  dueAt: string | null;
  /** Stored instants only; null when no stored fact exists. */
  at: { builtAt: string | null; buildFailedAt: string | null; saveFailedAt: string | null;
        acceptedAt: string | null; sentAt: string | null; approvedAt: string | null };
  /** Ranked merchant asks (heldState offer gates + effectiveChecklist). */
  asks: Array<{ id: "approve" | "parcel_outcome" | "ack" | "missing_evidence" | "bank_claim" | string;
                level: "required" | "optional"; label: I18nToken }>;
  /** Evidence items the package states to the bank, in reading order (ItemKey). */
  bankItems: ItemKey[];
  /** From refundStatement / noReturnApplicability; null = say nothing. */
  refundReturn: I18nToken | null;
  /** From deadlineFilingCopy(state).filingOutcome — never inferred here. */
  filingOutcome: FilingOutcome | null;
  fatalReason: "refund_issued" | "inr_no_fulfillment" | null;
  reopenedAt: string | null; escalatedAt: string | null;
}
```

Rules at the seam: a missing field → the slot that needs it is omitted (never defaulted to a reassuring sentence). `asks` ordering and the `required` flag are the sibling plan's decision; the copy only renders them. If the sibling plan lands a different shape, step 1 adapts the mapping, not the copy rules.

---

## 3. Copy changes

1. **Remove from hero + package card:** `roles.open`, `filed.version*`, `prepared.version`. Counts stay as Evidence-tab chips (`counts`, `ui.role*` unchanged). `roles.decided` removed from the decided hero too (the decided view already names cited/withheld lists).
2. **"What the bank gets":** `bank = tk("status.bank", { list })` built with the existing `listToken("cited", …)` + `phrase.cited.*` + `list.and.n*`, ordered as today (`pay, screen, delivery, ip, return`), followed by `refundReturn` when present. Shown from `ready` onward (it describes the package, not a filing).
3. **Slots per stage** (first match; one sentence each; dates via `fmt.date`):

| stage | done | waiting | next | action |
|---|---|---|---|---|
| building | "DisputeDesk is collecting the evidence." | DisputeDesk | — | none |
| build_failed / build_paused | "Evidence collected; the defence letter could not be written (D)." / "…paused by the daily limit" | DisputeDesk | omitted unless a stored retry fact exists | none — but ≤3 days to due: "Nothing from DisputeDesk has reached the bank yet." |
| ready / saving | "The defence is ready (D)." | DisputeDesk | "It is being filed through Shopify." | asks |
| awaiting_approval | "The defence is ready (D)." | **you** | "DisputeDesk files nothing until you approve." + `deadlineFilingCopy` Shopify sentence (undated) | required: approve |
| approved_scheduled | "You approved it (D)." | the deadline | "Scheduled to be filed on the deadline day, D. It is checked again before anything is sent." | none |
| held_for_deadline / withheld | existing `deadlineFilingCopy` title/body/action | the deadline | idem | idem |
| save_failed | "The defence is ready, but Shopify did not accept it (D)." | DisputeDesk | "Nothing from DisputeDesk has reached the bank yet." | none (ours to fix) |
| accepted_by_shopify | "DisputeDesk filed the defence through Shopify on D." | Shopify | "Shopify passes it to the cardholder's bank." | none |
| sent_to_bank | "The response went to the bank through Shopify on D." | the bank | inquiry: "If the bank is satisfied the inquiry closes; otherwise it can become a chargeback." · chargeback: "The bank decides." (no duration) | none |
| covered / fatal / decided | existing tokens, unchanged | | | |

   Every open, not-yet-sent stage ends with `due` ("Shopify's deadline is D.").
4. **Action rule:** `action.none` ("No action is required") renders **only** when `asks` has no `required` item. Required ask → `action.required.{id}` imperative. Optional asks → one sentence "Optional: {label} would strengthen the case." Headline `needs_attention` is chosen by the seam (required ask present), never by an optional ask.
5. **Inquiry explainer once:** `status.inquiry` ("This is an inquiry: the bank is asking before it becomes a chargeback.") placed after `claim`, only when `phase === "inquiry"` and not decided; removed from anywhere else on the page that repeats it (`inquiryHeroExplain`, `inquiryInfoHeadline` are not on this page — verify, do not touch other surfaces).
6. **Rewrite unconditional promises:** `autopilot`, `held`, `reviewMode.approved` → "scheduled … checked again" wording; `headline.saved` / `chip.saved` → "Filed through Shopify" (en) / "Inlämnat via Shopify" (sv); `filed.plain*` keep date, drop version.
7. **Vocabulary:** sv uses **"chargeback"** (majority: 116 vs 65 "återkrav" repo-wide, 34 vs 10 in `disputes.*`) — `record.escalated` + `timeline.t.escalated` change "återbetalningskrav" → "chargeback". Other locales: grep `disputes.*` for their established term and align `record.*` to it. Never: "Shopify automatic response", "submit response", "submit to card network", "file dispute response", bare AVS/CVV codes.
8. **Keys:** new keys under `disputes.record.status.*` (`done.*`, `waiting.*`, `next.*`, `action.required.*`, `action.optional`, `bank`, `inquiry`); delete orphaned `roles.open`, `filed.version*`, `prepared.version` in all 6 locales same PR (parity script). No English in `lib/` (rule 5).

---

## 4. Sample texts — for maintainer sign-off (sv + en)

Swedish gets 2–3 headline alternatives at PR time (memory: Swedish quality). Dates/amounts illustrative.

**S1 saved-and-accepted (chargeback)**
- sv: **Inlämnat via Shopify** · Kortinnehavaren sa till sin bank att ordern aldrig kom fram. DisputeDesk lämnade in försvaret via Shopify den 10 nov. Banken får betalningskontrollen och leveransen. Shopify skickar det vidare till kortinnehavarens bank. Du behöver inte göra något.
- en: **Filed through Shopify** · The cardholder told their bank the order never arrived. DisputeDesk filed the defence through Shopify on 10 Nov. The bank gets the payment check and the delivery. Shopify passes it to the cardholder's bank. No action is required.

**S2 save failed (inquiry)**
- sv: **Kunde inte lämnas in** · Kortinnehavaren sa till sin bank att ordern aldrig kom fram. Det här är en förfrågan: banken frågar innan det blir en chargeback. Försvaret är klart, men Shopify tog inte emot det (10 nov). Inget från DisputeDesk har nått banken än. Shopifys frist är den 20 nov.
- en: **Could not be filed** · The cardholder told their bank the order never arrived. This is an inquiry: the bank is asking before it becomes a chargeback. The defence is ready, but Shopify did not accept it (10 Nov). Nothing from DisputeDesk has reached the bank yet. Shopify's deadline is 20 Nov.

**S3 build failed**
- sv: **Försvaret kunde inte byggas** · Kortinnehavaren sa till sin bank att en återbetalning aldrig genomfördes. Underlaget är insamlat, men försvarsbrevet kunde inte skrivas (10 nov). Inget från DisputeDesk har nått banken än. Shopifys frist är den 13 nov.
- en: **The defence could not be built** · The cardholder told their bank a refund was never processed. The evidence is collected, but the defence letter could not be written (10 Nov). Nothing from DisputeDesk has reached the bank yet. Shopify's deadline is 13 Nov.

**S4 review, awaiting approval**
- sv: **Väntar på ditt godkännande** · … Försvaret är klart (8 nov). Banken skulle få betalningskontrollen, Shopifys bedrägerikontroll och IP-platsen. DisputeDesk lämnar inte in något förrän du godkänner. Godkänn försvaret, eller välj att inte lägga till något. Shopifys frist är den 20 nov.
- en: **Waiting for your approval** · … The defence is ready (8 Nov). The bank would get the payment check, Shopify's fraud screening and the IP location. DisputeDesk files nothing until you approve. Approve the defence, or choose not to add one. Shopify's deadline is 20 Nov.

**S5 returned-parcel question open (required ask) — REMOVED 2026-11-10: the answer reached no letter claim, so the question is no longer asked (see §10 A and H)**
- sv: **Behöver ditt svar** · … Försvaret är klart (9 nov). Kom paketet tillbaka till dig? Svara på fliken Bevis så tar DisputeDesk med svaret. Shopifys frist är den 18 nov.
- en: **Needs your answer** · … The defence is ready (9 Nov). Did the parcel come back to you? Answer on the Evidence tab and DisputeDesk includes it. Shopify's deadline is 18 Nov.

**S6 held for deadline** (body = existing `deadlineFilingCopy` deadline_only text, reproduced not re-authored)
- sv: **Hålls kvar till fristen** · … Försvaret är klart (7 nov). Det är schemalagt att lämnas in på fristens dag, 20 nov, och kontrolleras igen innan något skickas. Du behöver inte göra något. Valfritt: kortinnehavarens bekräftelse skulle stärka ärendet.
- en: **Held until the deadline** · … The defence is ready (7 Nov). It is scheduled to be filed on the deadline day, 20 Nov, and is checked again before anything is sent. No action is required. Optional: the cardholder's acknowledgement would strengthen the case.

**S7a sent to bank — inquiry**
- sv: **Skickat till banken** · … Svaret skickades till banken via Shopify den 11 nov. Om banken nöjer sig stängs förfrågan, annars kan den bli en chargeback. Du behöver inte göra något.
- en: **Sent to the bank** · … The response went to the bank through Shopify on 11 Nov. If the bank is satisfied the inquiry closes; otherwise it can become a chargeback. No action is required.

**S7b sent to bank — chargeback**
- sv: **Skickat till banken** · … Svaret skickades till banken via Shopify den 11 nov. Banken beslutar. Du behöver inte göra något.
- en: **Sent to the bank** · … The response went to the bank through Shopify on 11 Nov. The bank decides. No action is required.

---

## 5. Rule-8 note

The hero paragraph, its fact order and the role-count sentence come from Claude Design `NewDispute.dc.html` (MCP returned 403 this session — not re-fetched). This plan **deviates from a finished design**: removes `roles` and `version`, adds waiting/next/inquiry/bank slots, renames the saved headline/chip. Before implementation: (a) maintainer signs off §4 samples in-chat; (b) the design file is updated to match, **or** the deviation is recorded in `docs/technical.md` § dispute record with date and the signed-off samples. No other visual element of the page changes (layout, chips, cards, Evidence tab untouched).

---

## 6. Steps

1. **Seam adapter** — `lib/disputes/presentation/statusCopy.ts`: `composeStatusCopy(account: StatusAccount, fmt)` with exhaustive `switch`, tokens only. *AC:* `tsc` fails if a stage is unhandled; file contains no reads of `pack`, `status ===`, `savedToShopifyAt`, or audit types (grep test).
2. **Wire `disputeRecord.ts`** — `ACCOUNT`, `pkgLines` and open-dispute timeline texts come from the composer's slots; delete `roles` / `version` facts and the stage-keyed action branch (`:843-848`). *AC:* `account` for every open stage = `claim, inquiry?, reopened?, escalated?, done, bank?, refundReturn?, next, action, due?` (present keys only).
3. **Messages** — add `status.*`, rewrite §3.6 keys, sv vocabulary fix, delete orphans, all 6 locales same PR. *AC:* `scripts/verify-i18n-parity.mjs` green; no orphan keys.
4. **Tests** — snapshot `composeStatusCopy` + rendered hero string over every `stage` × {inquiry, chargeback} × {no ask, optional ask, required ask} × 6 locales.
5. **Docs** — `docs/technical.md` dispute-record section + embedded help (`help.embedded.*`) where it describes the status line; rule-8 deviation entry.

## 7. Acceptance criteria

1. Over the full snapshot matrix: no hero/package/timeline string contains a version word followed by a number (en/fr/sv "version", de "Version", es "versión", pt "versão"), nor any `roles.*` label text ("Cited to the bank:", "Angivet för banken:", …).
2. No string contains `action.none` text when the fixture has a `required` ask; every `required` ask produces exactly one imperative action sentence.
3. No string contains "will" / "kommer att" + file/save verb tied to a date; scheduled states use the `scheduled … checked again` tokens. No "retry", "alerted", "support", duration-to-decision tokens exist under `status.*`.
4. Inquiry explainer appears exactly once for open inquiries, zero times for chargebacks/decided.
5. sv `disputes.record.*` contains no "återbetalningskrav" and no "återkrav"; other locales use their grep-established term.
6. Forbidden-copy CI grep green; additional grep: no "Shopify automatic response" / localized equivalents in `messages/*.json`.
7. i18n parity green; `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run release:verify` green; critic pass on the diff.

## 8. Verification

- Dev (`dev.disputedesk.app`): screenshot the hero for one dispute per reachable stage on ≥2 shops (incl. one review-mode shop, one inquiry) in sv and en; compare to §4 samples line-by-line.
- Prod: branch → PR to `master` → **stop for explicit in-chat go** (rule 9); after deploy, screenshot the two disputes the merchant flagged.

## 9. Open questions (maintainer)

1. sv term: "chargeback" (proposed, majority) vs "återkrav"?
2. Headline/chip "Filed through Shopify" replacing "Saved to Shopify" — accept? (The truthful verb per `submitEvidence: true`.)
3. Should "The bank would get …" show in `awaiting_approval` (a list of a not-yet-filed package) or only from `ready` on?
4. Is the decided view's role-count sentence also removed (proposed) or kept there?

## ADR

- **Decision:** Option B — a pure slot composer over the sibling plan's `StatusAccount`; remove version numbers and role counts from the hero; four slots per state; promises rewritten to "scheduled".
- **Drivers:** unreadable/self-contradictory status; state model moving under the copy; rule-8 design deviation.
- **Alternatives:** A (token patch — copy keeps its own state model); C (LLM summary — unprovable, cost).
- **Why chosen:** one seam, one precedence table, compile-time exhaustiveness; copy cannot drift from state.
- **Consequences:** blocked on the sibling plan's object; ~60 keys × 6 locales; design file or deviation record must change.
- **Follow-ups:** reuse `composeStatusCopy` for the dispute-list status column and merchant emails (separate plans).

---

## 10. Action-first style (maintainer direction, 2026-11-10) — supersedes the §4 samples

The maintainer rejected the §4 samples as still too low-level: the Overview is the first thing a merchant sees, and it must say what the status is and what to do, in plain words. §4's one-paragraph form is replaced by a fixed five-part block.

**Rules**
1. The headline is the one thing the merchant must do, or starts with "Nothing to do" when that is true.
2. "What happened": two plain sentences, including the fact that changes the case (parcel came back, refund on record, Shopify rejected the file).
3. "What we need from you": the ask, why it matters, and the button, on the Overview itself. Absent when there is nothing to do.
4. "What happens next": both branches where the merchant has a choice, each with a date when one exists.
5. "Done so far": one line. No counts, versions, percentages or internal labels anywhere.
6. Only claims the system can back. Lines marked (verify) must be checked against the code path before shipping.

Sub-line under every headline: `{Inquiry|Chargeback} · {amount} · Shopify's deadline is {date}` (decided: the decision date).

### A. A required answer is open (example: the return confirmation)
A required ask exists only if a named module consumes its answer (`consumedBy` in `lib/disputes/merchantAsks.ts`). The worked example was the returned-parcel question (#17066); it was removed 2026-11-10 because its answer changed nothing in the letter, and its place here is taken by the return confirmation, whose answer (`merchantConfirmedNoRequest`) the credit-not-processed ledger reads.

**Your answer is needed today: did this customer ask for a return or refund?**
- What happened: The customer told the bank a refund was never processed. {the one fact that decides the case, when there is one}
- What we need from you: Shopify only records returns made through Shopify, so only you can say whether this customer asked for a return or refund before opening the dispute. **[Answer the question]**
- What happens next: If you answer, DisputeDesk rebuilds the response with your answer.
- Done so far: Order, payment and carrier records are collected and a response is drafted. Nothing has been filed.

### B. Your approval is needed (review mode)
**Your approval is needed: the response is ready**
- What happened: The customer told the bank the order never arrived. DisputeDesk wrote a response that relies on the carrier's delivery record and the payment check.
- What we need from you: Read the response and choose. **[Approve]** **[Don't add a response]**
- What happens next: If you approve, it is scheduled to be filed through Shopify on the deadline day, {date}. If you do nothing, DisputeDesk files nothing; a response still reaches the bank through Shopify from the order's own data.
- Done so far: Evidence collected, response written. Nothing has been filed.

### C. Scheduled for the deadline (auto mode, held)
**Nothing to do. The response is scheduled for {date}**
- What happened: The customer told the bank the order never arrived. The response is ready.
- What happens next: DisputeDesk waits until the deadline day in case more evidence arrives, checks the response again, and then files it through Shopify.
- You can make it stronger (optional): {the top optional ask, with its button}.
- Done so far: Evidence collected, response written. Nothing has been filed yet.

### D. Being filed
**Nothing to do. The response is being filed**
- What happens next: DisputeDesk is sending the response to Shopify now. This page updates when Shopify has accepted it.

### E. Filed
**Nothing to do. The response has been filed**
- What happened: DisputeDesk filed the response through Shopify on {date}. It relies on {named evidence}.
- What happens next (inquiry): Shopify passes it to the bank. If the bank is satisfied, the inquiry closes. If not, it can become a chargeback, and DisputeDesk prepares a new response. You get an email when the bank decides (verify).
- What happens next (chargeback): Shopify passes it to the bank, and the bank decides. You get an email when it does (verify).

### F. Could not be filed (our fault)
**DisputeDesk could not file this response. We are working on it**
- What happened: The response is ready, but Shopify did not accept the file when we sent it (last attempt {date}). Nothing from DisputeDesk has reached the bank.
- What we need from you: Nothing. This is a fault on our side, not something in your store.
- What happens next: DisputeDesk tries again on the deadline day, {date} (verify). If it still cannot be filed, you get an email (verify).
- Done so far: Evidence collected, response written.

### G. The response could not be written (our fault)
**DisputeDesk has not been able to write this response yet**
- What happened: The evidence is collected, but the response did not pass our checks (last attempt {date}). Nothing has been filed.
- What we need from you: Nothing right now.
- What happens next: DisputeDesk builds it again on the deadline day, {date}. If no response passes, DisputeDesk files nothing, you get an email, and a response still reaches the bank through Shopify from the order's own data.

### H. Nothing to argue (natural loss)
**DisputeDesk is not filing a response: the record does not support one**
- What happened: The customer told the bank the order never arrived. {The order was never shipped | The order has already been refunded in full | There is no delivery record for this order}.
- What you can do: If you have proof we cannot see, such as a delivery confirmation from the carrier, add it and DisputeDesk writes a response. **[Add evidence]**
- What happens next: Without it, a response still reaches the bank through Shopify from the order's own data. Expect this one to be lost.

**Returned to sender (example: #17066, 2026-11-10).** Same state, no ask: the parcel's return is a fact, not a question.
- What happened: The customer told their bank a refund was never processed. The carrier returned this parcel to you, so no proof of delivery can exist for it.
- What happens next: DisputeDesk checks the record once more on the deadline day, {date}. If nothing has changed, it files nothing, and Shopify still sends a response from the order's own data.
- No "What you can do" part (a returned parcel can never have a delivery confirmation), no "expect to lose" (only the fatal-loss rule says that), no suggestion to refund or concede. When a response DOES exist for a returned parcel, the normal state shows, with the same sentence in What happened.

### I. Covered by Shopify Protect
**Nothing to do. Shopify Protect covers this order**
- What happens next: Shopify handles this dispute itself. DisputeDesk files nothing for it.

### J. Plan limit reached
**Upgrade needed: this month's plan limit is used up**
- What happened: DisputeDesk has not prepared a response for this dispute. Your plan covers {limit} disputes a month and {used} are used.
- What we need from you: Choose a plan that covers your volume. **[See plans]**
- What happens next: Once the plan is changed, DisputeDesk prepares the response. Shopify's deadline is {date}.

### K. Decided
**Won: {amount} stays with you** / **Lost: {amount} went back to the customer**
- What happened: The bank decided on {date}. {DisputeDesk filed a response on {date} that relied on {named evidence} | DisputeDesk filed nothing for this dispute; a response went through Shopify}.
- Why (when known): {outcome explanation}.
- Next time (lost only): {the one prevention tip that applies}.

**Dropped from every state:** package version numbers, the four role counts, "No action is required" beside an open required ask, and the cardholder-acknowledgement suggestion where it does not fit the case (a parcel that never arrived).
