# Plan — Dynamic Klarna inquiry template

**Status:** proposed · **Author:** investigation 2026-07-05 · **Trigger:** inquiries already get a "lighter" template variant per `(reason, phase)` (migration `20260411150000_inquiry_template_variants.sql`), but those variants are **card/generic-oriented** — e.g. the fraud inquiry foregrounds AVS/CVV, which is meaningless for Klarna. When a Klarna dispute is an inquiry, it gets a light template whose items don't fit Klarna. We want a **Klarna-specific inquiry template that applies dynamically when the dispute is Klarna**.

---

## 1. How template selection works today (verified)

- **Pipeline routing** (`lib/automation/pipeline.ts`): on auto-build, `resolveAutomationTemplate(dispute)` picks a template by precedence:
  1. `dispute.pack_template_id` (rule-specified) →
  2. DB lookup in `reason_template_mappings` on `(reason_code, dispute_phase)` →
  3. `null` (buildPack falls back to hardcoded `REASON_TEMPLATES`).
  The chosen id is **stamped onto `evidence_packs.pack_template_id` BEFORE the `build_pack` job runs** (pipeline.ts:262-271).
- **buildPack** (`lib/packs/buildPack.ts`): reads `pack.pack_template_id` and loads its sections/items to drive the checklist (lines 424-461).

### The critical constraint
The template is chosen in the **pipeline**, where we have the `dispute` row (**reason, phase**) but **NOT the payment method**. Klarna is only known for certain **inside buildPack**, which fetches the live order and runs `derivePaymentContext(order)` (buildPack.ts:282) — and that happens *after* the template was already stamped.

So `(reason, phase, payment_method)` cannot be a pure pipeline-time lookup unless we learn "it's Klarna" earlier. Two facts shape the fix:
- `disputes` has **no** payment-method column; the method lives on `shopify_orders.payment_method` (joinable via `disputes.order_gid`). For cay-collective **all 66 disputes join** — but for a brand-new dispute the order may not be ingested yet.
- buildPack **already** derives the payment context and **already** consumes `pack_template_id` — so it is the one place guaranteed to know "this is Klarna" at build time.

**Design decision:** do the Klarna swap **in buildPack** (authoritative, always-correct), with an optional pipeline-time fast-path when the order is already cached (nice-to-have, not required for correctness).

---

## 2. Design — where the Klarna inquiry template gets applied

### 2.1 Authoritative path: swap inside buildPack (REQUIRED)
In buildPack, right after `derivePaymentContext(order)` (line 282) and before loading template items (line 424):

- If `paymentContext.family === "klarna"` **AND** `dispute.phase === "inquiry"`, resolve the Klarna inquiry template for `dispute.reason` and use **that** template's items instead of the pre-stamped one.
- Encapsulate as a pure helper `resolveKlarnaInquiryTemplateId(reason)` → returns the Klarna inquiry template id or `null`. buildPack overrides `templateId` when non-null.
- Record the swap: log + write to `pack_json` (e.g. `template_override: { from, to, reason: "klarna_inquiry" }`) so admin (source of truth) shows *why* this pack used a different template than the pipeline stamped. Optionally update `evidence_packs.pack_template_id` to the Klarna one so downstream reads are consistent.

This path is correct for **100%** of Klarna inquiries because buildPack always has the real payment context.

### 2.2 Optional fast-path: pipeline-time hint (NICE-TO-HAVE, later)
`resolveAutomationTemplate` could, when `phase === "inquiry"`, join `disputes.order_gid → shopify_orders.payment_method` and, if `payment_method LIKE 'klarna%'`, stamp the Klarna inquiry template directly. Benefit: the pack is stamped correctly from the start (admin shows the right template pre-build). Limitation: only works when the order is already cached — otherwise it falls through and §2.1 fixes it at build. **Not required** (2.1 covers it); do only if the pre-build admin display matters.

### 2.3 Do NOT reuse the `reason_template_mappings` (reason, phase) key
That table is keyed on `(reason_code, dispute_phase)` — a 2-D key with no payment-method dimension. Adding Klarna there would either (a) require a 3-D key migration touching a load-bearing table, or (b) wrongly repoint ALL inquiries (card included) to Klarna templates. Keep Klarna resolution **separate** (a dedicated map/helper), leaving the existing card/generic mappings untouched.

---

## 3. The Klarna inquiry templates (content)

Mirror the 8 existing inquiry variants but **Klarna-tuned** — drop card constructs, foreground what Klarna actually weighs (from `docs/klarna-dispute-handling-reference.md`). Klarna's live inquiry reasons in the data are `PRODUCT_NOT_RECEIVED` and `CREDIT_NOT_PROCESSED`, so prioritize those; add the others for completeness.

| Reason | Klarna inquiry template | Items (light, 2–3) | vs. the card inquiry variant |
|---|---|---|---|
| PRODUCT_NOT_RECEIVED | `klarna_pnr_inquiry` | tracking status (req), delivery/POD detail (req: carrier + date + address + recipient), shipping notification (opt) | Same shape; guidance stresses Klarna's Proof-of-Delivery (tracking link alone insufficient) |
| CREDIT_NOT_PROCESSED | `klarna_refund_inquiry` | refund status note (req), refund/return policy (opt), customer correspondence (opt) | No card refund framing; Klarna refund-entitlement framing |
| PRODUCT_UNACCEPTABLE | `klarna_not_as_described_inquiry` | order summary (req), resolution offered (req: repair/replace/refund), return label (opt) | Klarna weighs the resolution offered |
| FRAUDULENT / UNRECOGNIZED | `klarna_unauthorized_inquiry` | order + delivery-to-customer (req), account/identity (opt) | **NO AVS/CVV** (the whole point — card variant's fraud items are meaningless for Klarna) |
| DUPLICATE | `klarna_duplicate_inquiry` | transaction list (req), order breakdown (req) | Invoice-tied-to-order framing |
| others | fall back to the existing card `general_inquiry` | — | Klarna variant only where it materially differs |

**Key content rule:** every Klarna inquiry item's `collector_key` maps to a real Klarna-relevant collector (delivery, refund, policy, customer comms) — **never** `avs_cvv_match` / 3DS. The narrative overlay (`lib/defence/klarnaOverlay.ts`, already shipped) then frames the prose; this plan makes the **checklist/template** Klarna-aware too, so completeness scores against the right items.

Delivered as a migration (mirrors `20260411150000`): new `pack_templates` rows (`klarna_*_inquiry`), sections, items with correct `collector_key`, i18n across the 6 active locales. **No** change to `reason_template_mappings`.

---

## 4. Phasing

1. **Phase 1 (core):** the buildPack swap (§2.1) + a migration for the two high-value Klarna inquiry templates (`klarna_pnr_inquiry`, `klarna_refund_inquiry`) — covers cay-collective's actual inquiry mix. Helper + unit tests (Klarna inquiry → Klarna template; card inquiry → unchanged; Klarna chargeback → unchanged). Admin records the override.
2. **Phase 2:** remaining Klarna inquiry variants (not-as-described, unauthorized, duplicate) + i18n.
3. **Phase 3 (optional):** the pipeline-time fast-path (§2.2) for correct pre-build admin display.

## 5. Verification / done criteria (Phase 1)

- A Klarna dispute with `phase="inquiry"`, reason `PRODUCT_NOT_RECEIVED`, builds a pack using `klarna_pnr_inquiry` — its checklist foregrounds delivery/POD, and contains **no** AVS/CVV item.
- A **card** inquiry (same reason) is **unchanged** (still `pnr_inquiry`).
- A Klarna **chargeback** is **unchanged** (full Klarna-narrative chargeback pack; only inquiries get the light Klarna template).
- The template override is recorded in `pack_json` + visible in admin.
- Migration applied to dev + prod (same session); `npm test` + `tsc` + `build` green; i18n parity clean.

## 6. Out of scope / do NOT do

- **Don't** add a payment-method column to `disputes` or a 3-D key to `reason_template_mappings` — resolve Klarna separately in buildPack.
- **Don't** touch the card/generic inquiry templates or their mappings.
- **Don't** put AVS/CVV/3DS items in any Klarna template.
- **Don't** change chargeback behavior — this is inquiry-only.
- **Don't** block on the deadline plan — this template work is independent of (though complementary to) `klarna-inquiry-deadline-countdown.plan.md`.

## 7. Open questions for you

1. **Scope of variants:** Phase-1 just the two live ones (PNR + refund), or all five up front?
2. **Override display:** is recording the swap in `pack_json` + admin enough, or do you also want the merchant-facing UI to name the Klarna template?
3. **Fast-path:** do you care about correct template display *before* the pack builds (needs §2.2), or is build-time correctness sufficient?
