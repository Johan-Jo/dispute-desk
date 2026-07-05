# Plan — Klarna-aware deadline countdown for inquiries

**Status:** proposed · **Author:** investigation 2026-07-05 · **Trigger:** cay-collective (Klarna-heavy, integrated 2026-07-02). We use Shopify's single generic `evidenceDueBy` (~18–20 days observed) verbatim, with no Klarna- or phase-aware deadline logic. Klarna's own inquiry/dispute windows are much tighter (96h fraud / 7d unauthorized / 14d other). If Klarna's real cutoff is tighter than Shopify's date, auto-submitting on the Shopify date could miss it.

---

## 0. What we already verified (facts, not assumptions)

All confirmed against prod data + code inspection 2026-07-05:

1. **We store one deadline:** `disputes.due_at`, read verbatim from Shopify `Dispute.evidenceDueBy` (`applyDisputeSnapshot.ts:295`). No payment-method / phase / reason adjustment anywhere.
2. **The deadline-submit cron** (`app/api/cron/defence-package-deadline-submit`) scans `due_at` in the current 24h UTC window and auto-submits — **for all phases**, inquiry included (no phase filter).
3. **Inquiry evidence submission through Shopify WORKS and already happens.** cay-collective: 4 inquiry-phase disputes had `evidenceSentOn` set (evidence submitted to the network via Shopify). Our submit path (`saveToShopifyJob`) calls `disputeEvidenceUpdate(submitEvidence:true)` identically for inquiry and chargeback — no phase gating.
4. **Shopify auto-submits on BOTH phases at its own (long) deadline.** All 8 cay-collective submissions (4 inquiry + 4 chargeback) fired ~7–11h *past* `due_at` — the auto-submit signature — at the ~18-day Shopify window.
5. **Shopify's `evidenceDueBy` is generic/long** (min ~434h ≈ 18 days observed), NOT Klarna's 96h/7d/14d.
6. **We have NO proof the Shopify window is safe for Klarna**, because DisputeDesk has never *driven* a Klarna submission (merchant integrated 2 days ago; the 8 sends were Shopify's own auto-submit, not ours). The 47 no-evidence inquiry wins tell us nothing about our pipeline — the merchant may have acted offline (called Klarna, responded in Admin); we don't know and shouldn't assume.

**Bottom line the plan addresses:** the countdown/auto-submit we show and act on is Shopify's generic date. If Klarna enforces a tighter internal cutoff, we could submit late by Klarna's clock while looking on-time by Shopify's. This plan makes the deadline **Klarna-aware** and answers the load-bearing open question.

---

## 1. The load-bearing open question (resolve FIRST — gates everything)

**Does Shopify's `evidenceDueBy` already reflect Klarna's tighter window, or is it always Shopify's generic ~18-day date?**

- If Shopify already tightens `evidenceDueBy` for Klarna → there is **no gap**; this plan reduces to "surface it clearly," and the tighter-countdown work is unnecessary.
- If Shopify always reports its generic window regardless of Klarna → the gap is **real** and the countdown/auto-submit needs a Klarna-aware safety margin.

**How to resolve (no code, cheap):**
1. **Ask the merchant** (you said you'd do this): for a recent Klarna dispute, did Klarna email/notify a deadline shorter than what Shopify Admin showed? Did they respond in Klarna's portal or in Shopify Admin?
2. **Watch the first real Klarna dispute that flows through DisputeDesk's submit path:** compare `evidenceDueBy` vs `initiatedAt` and, when it finalizes, whether an on-Shopify-deadline submit was accepted by Klarna. One real data point settles it.
3. **Shopify support / docs check:** confirm whether `evidenceDueBy` for a Shopify-Payments-Klarna dispute is Klarna's window or Shopify's internal one.

**Do not build Phase 3 (tighter auto-submit) until this is answered** — building a safety margin against a deadline Shopify already enforces would just submit early for no reason.

---

## 2. Phase 1 — Make the deadline observable + honest (low risk, ship regardless)

Ship this even before Q1 is answered — it's correct either way and de-risks the unknown.

### 2.1 Surface the phase + a Klarna-deadline hint in the merchant UI
- The Overview deadline countdown (`OverviewTab.tsx`, `deadlineDays`) currently shows the raw Shopify `due_at`. Add, **for Klarna disputes only**, a secondary line: *"Klarna disputes can have a shorter internal deadline than the date shown — respond as early as possible."* Non-alarming, honest, no false precision (we don't invent a Klarna date we can't verify).
- Label the **phase** (Inquiry vs Chargeback) on the dispute — this already has helpers (`phaseUtils.ts` `phaseLabel`/`phaseBadgeTone`) but inquiries are under-surfaced in the merchant UI (known gap: `project_inquiry_visibility_gap`). Fold that in here.

### 2.2 Admin visibility of auto-submit vs. DisputeDesk-driven
- In admin, flag whether a dispute's evidence was **Shopify-auto-submitted** (`submitted_at ≥ due_at`, no `evidence_saved_to_shopify_at`) vs **DisputeDesk-submitted**. This is pure derivation from fields we already store (`submitted_at`, `evidence_saved_to_shopify_at`, `due_at`). Gives ops the "who actually submitted" signal the current dashboard lacks, and starts building the evidence base to answer Q1.

### 2.3 Verify inquiry submission end-to-end once
- We have data proof Shopify accepts inquiry evidence (4 sends), but never via **our** mutation. Add a targeted check/log so the first DisputeDesk inquiry submission records the `userErrors` outcome explicitly — if Shopify ever rejects inquiry-phase `disputeEvidenceUpdate`, we learn immediately rather than silently failing.

## 3. Phase 2 — Klarna deadline model (build only if Q1 says the gap is real)

If Q1 confirms Shopify's window is generic (not Klarna's):

### 3.1 A Klarna deadline estimator (advisory, not authoritative)
- Add `lib/disputes/klarnaDeadline.ts`: given `initiatedAt` + reason/phase, compute Klarna's documented window (fraud/unauthorized 96h–7d; other 14d — from `docs/klarna-dispute-handling-reference.md`). Return an **advisory** `klarnaDeadlineEstimate` — clearly labelled an estimate, never overwriting Shopify's `due_at`.
- Persist it (or compute on read) alongside `due_at` so both the countdown and the cron can see "Shopify says X, Klarna likely Y (earlier)."

### 3.2 Effective deadline = min(Shopify, Klarna-estimate) for the countdown
- Merchant countdown shows the **earlier** of the two, so a merchant never relies on the longer Shopify date when Klarna's is tighter. Framed as "respond by" with the source noted.

### 3.3 Auto-submit safety margin
- The deadline-submit cron should, **for Klarna disputes**, fire on the **earlier** effective deadline (with a small safety buffer), not the Shopify date — so we don't auto-submit late by Klarna's clock.
- Guard rails: never submit an incomplete/blocked pack early just to beat an *estimated* deadline; the existing auto-save quality gate still applies. Log when the Klarna estimate moved the submit earlier.

## 4. Phase 3 — Outcome learning (later, data-gated)

Once real Klarna disputes flow through our submit path, compare: did on-Shopify-deadline submits get accepted by Klarna, or did earlier submits win more? Calibrate the estimator against real outcomes. Do not pre-optimize before we have DisputeDesk-driven Klarna outcomes.

---

## 5. Explicitly out of scope / do NOT do

- **Don't** overwrite Shopify's `due_at` with a computed Klarna date — Shopify's is the authoritative submission deadline for the Shopify Payments dispute object; the Klarna estimate is advisory only.
- **Don't** auto-submit early against an *estimated* deadline before Q1 confirms the gap is real (would submit prematurely for no reason if Shopify already enforces Klarna's window).
- **Don't** treat the 47 no-evidence inquiry wins as "free wins" or as proof of anything about our pipeline — the merchant may have acted offline; we don't know.
- **Don't** build a Klarna-portal submission path — we submit via Shopify Admin, and inquiry submission through Shopify is confirmed working.

---

## 6. Sequencing

1. **Q1 first** (§1) — cheap, gates the rest. Merchant question + first-real-dispute watch + Shopify docs check.
2. **Phase 1** (§2) — ship now regardless; honest countdown + phase label + auto-vs-DD-submit admin flag + inquiry-submit verification.
3. **Phase 2** (§3) — only if Q1 shows a real gap.
4. **Phase 3** (§4) — data-gated, later.

## 7. Done criteria (Phase 1)

- Merchant Overview shows the phase (Inquiry/Chargeback) and, for Klarna, a "may have a shorter deadline — respond early" hint without inventing a false date.
- Admin can tell Shopify-auto-submitted disputes from DisputeDesk-submitted ones (derived from existing fields).
- The first DisputeDesk inquiry submission records its Shopify `userErrors` outcome explicitly.
- `npm test` + `tsc` green; no change to card-dispute deadline behavior.
