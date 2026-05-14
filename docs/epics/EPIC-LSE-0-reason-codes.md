# EPIC LSE-0 — Network Reason Code Foundation

> **Status:** Planned
> **Phase / week target:** Pre-Phase 1 of Liability-Shift Engine — Weeks 0–4 (overlaps the start of LSE-1)
> **Dependencies:** EPIC 1 (Dispute Sync), EPIC 2 (Pack Builder), EPIC A1 (Automation Pipeline)
> **Track:** LSE (Liability-Shift Engine) — foundational
> **Source PRD:** [`docs/liability-shift-engine-prd.md`](../liability-shift-engine-prd.md) §2 (program rules), §4 (qualification logic referencing reason codes)

## Goal

Resolve every synced dispute to its **network-level reason code** (Visa 10.x / 11.x / 12.x / 13.x or Mastercard 48xx) and use that code — not Shopify's coarse 14-value enum — to drive:

1. CE 3.0 eligibility (LSE-1 needs Visa 10.4 specifically)
2. FPT eligibility (LSE-3 needs the Mastercard first-party-fraud reason allowlist)
3. Rebuttal text phrasing (today: one template per Shopify enum value; after this epic: one template per network code)
4. Evidence-checklist tailoring (today: PRODUCT_NOT_RECEIVED requires "delivery proof"; after this epic: Visa 13.1 vs 13.2 vs 13.3 each ask for different proofs)

Why this exists as a separate epic: today's code reads `dispute.reason` (Shopify's enum) and never sees the underlying network code. That works for "good enough" rebuttals on legacy representment, but the LSE track relies on network-code precision throughout. Building this as a foundation under LSE-1 also retroactively improves the standard rebuttal flow.

## Non-goals (explicit)

- Replacing Shopify's enum throughout the app (the enum stays — it's the coarse bucket for UI/triage). This epic adds a **second** field: the network code.
- Translating between network codes and standard representment evidence requirements — that's downstream consumer work that lives in EPIC-2 / LSE-2 templates.
- Predicting reason codes when Shopify doesn't supply them (we accept "unknown_network_code" as a valid state and fall back to the Shopify enum).

## Background: where the network code actually lives

Shopify Payments **does** know the network reason code internally — it just doesn't surface it cleanly on every dispute:

| Source | What we get | Reliability |
|--------|-------------|-------------|
| `Dispute.reason` (GraphQL enum) | Coarse 14-value enum (FRAUDULENT, PRODUCT_NOT_RECEIVED, …) | Always present |
| `Dispute.networkReasonCode` (if exposed in current API version) | e.g. `"10.4"`, `"4837"` | API-version dependent — verify against current `shopify.app.toml` API version |
| `Order.transactions[].receiptJson` (Shopify Payments only) | Sometimes carries `reason_code` inside the gateway receipt | Gateway-specific; "not a stable contract" (per the 3-D Secure note in CLAUDE.md) |
| Webhook `disputes/create` payload | Sometimes richer than the GraphQL field | Verify in dev store |

**First implementation task** is a verification pass on a dev store + at least one merchant with real disputes to map exactly what's reliably available in the current API version. If `networkReasonCode` is exposed: use it. If it's not: derive a best-guess from `(Dispute.reason, network, receiptJson.reason_code)` with confidence tracking, and surface the uncertainty in the admin panel.

## Architecture

```
dispute synced (EPIC 1)
       │
       ▼
resolveNetworkReasonCode(dispute, order)
   ├─ try Dispute.networkReasonCode (preferred)
   ├─ try receiptJson.reason_code (Shopify Payments path)
   └─ fall back to inferFromShopifyEnum(network, reason)
                              └─ returns code + confidence
       │
       ▼
writes dispute.network_reason_code +
       dispute.network_reason_code_confidence

       │
       ▼
consumed by:
   ├─ LSE-1 qualifyCE30 (already drafted)
   ├─ LSE-3 qualifyFPT  (already drafted)
   ├─ rebuttalReason.ts (extended to switch on network code where available)
   ├─ completeness engine (extended templates per network code)
   └─ admin reason-mapping panel (already drafted, extended)
```

**Touchpoints:**
- New module: `lib/disputes/networkReasonCode.ts` (resolver + inference)
- New module: `lib/disputes/reasonCodeCatalog.ts` (canonical list of Visa + Mastercard codes with metadata)
- Extend: `lib/disputes/syncDisputes.ts` to call resolver and write the field
- Extend: `lib/argument/rebuttalReason.ts` to read `network_reason_code` when present and pick a more specific template
- Extend: `lib/automation/completeness.ts` to use network-code-specific checklists when available
- Extend: existing admin reason-mapping UI to manage network-code → template overrides

## Reason code catalog

A canonical, code-first catalog stored as a TypeScript constant (not a runtime DB table) so changes go through code review. Each entry:

```ts
interface ReasonCode {
  code: string;           // "10.4", "4837"
  network: "visa" | "mastercard" | "amex" | "discover";
  family:
    | "fraud"
    | "authorization"
    | "processing_error"
    | "consumer_dispute"
    | "fpt_eligible"     // mastercard subset
    | "ce30_eligible";   // visa subset (10.4 today)
  shortName: string;      // "Other Fraud — CNP"
  description: string;    // full Visa/MC text (versioned)
  rebuttalTemplateKey: string;
  evidenceChecklistKey: string;
  shopifyEnumFallbacks: AllDisputeReasonCode[]; // which Shopify enums collapse here
  introducedDate: string; // for tracking rule changes
  retiredDate?: string;
  notes?: string;
}
```

**Initial population scope (must ship in v1 of this epic):**
- Visa: 10.1, 10.2, 10.3, **10.4** (CE 3.0 anchor), 10.5, 11.1, 11.2, 11.3, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9
- Mastercard: 4807, 4808, 4812, 4831, 4834, 4837 (FPT-eligible), 4841, 4842, 4846, 4849, 4850, 4853, 4854, 4855, 4859, 4860, 4863 (FPT-eligible), 4870, 4871, 4999
- Amex / Discover: minimal coverage — code + family only — full templates deferred to a later iteration since LSE programs are Visa/MC only

Numbers above are the active 2025 set; verify against current Visa Core Rules and Mastercard Chargeback Guide before final commit. Encode "this entry was current as of YYYY-MM" so audits are tractable.

## Database changes

Migration: `supabase/migrations/NNN_lse_network_reason_code.sql`

### Extend `disputes`

| Column | Type | Description |
|--------|------|-------------|
| `network_reason_code` | text nullable | e.g. `10.4`, `4837` |
| `network_reason_code_confidence` | text | `direct` (from Shopify API field), `derived` (from receiptJson), `inferred` (fallback from enum + network), `unknown` |
| `network_reason_code_resolved_at` | timestamptz | When we computed it |

Index: `(shop_id, network_reason_code)` for analytics + downstream qualification queries.

### No new tables

The catalog lives in code (`lib/disputes/reasonCodeCatalog.ts`) for the reasons described above.

## Job / pipeline integration

In `runAutomationPipeline` (existing EPIC-A1 module), insert `resolveNetworkReasonCode` **before** `evaluateQualification` (LSE-1). Sync also writes the field on initial dispute insert in `lib/disputes/syncDisputes.ts` so the data is present for first qualification run, not just re-evaluations.

When confidence is `unknown`, qualification (LSE-1 / LSE-3) falls back to the Shopify enum and caps verdict confidence at `low`.

## Rebuttal text changes

`lib/argument/rebuttalReason.ts` and `lib/argument/generateRebuttal.ts` evolve from:

```ts
// today
const mapping = REASON_MAP[dispute.reason]; // dispute.reason = "FRAUDULENT"
```

to:

```ts
// after this epic
const mapping =
  dispute.network_reason_code
    ? NETWORK_REASON_MAP[dispute.network_reason_code] ??
      REASON_MAP[dispute.reason]
    : REASON_MAP[dispute.reason];
```

Per `feedback_bank_optimized_rebuttal` (memory): the network-code path lets the rebuttal speak the issuer's language directly — "the disputed transaction is properly classified under Visa reason code 13.1 (Merchandise/Services Not Received), and the merchant has documented delivery as follows…" — rather than the generic "the customer claims they did not receive the product…". Never expose weakness, always strengthen.

Each network code gets:
- One default `rebuttalTemplateKey` per code (versioned i18n key)
- Family-level fallback (e.g. all `consumer_dispute` codes share a tone register)

Templates are translated across all 6 locales in the same session (per `feedback_translate_on_add`).

## Evidence checklist changes

`lib/automation/completeness.ts` reads the network-code-specific checklist when available. For example:

- **Visa 13.1 (Merchandise/Services Not Received):** requires tracking + delivery proof + delivery address match
- **Visa 13.2 (Cancelled Recurring):** requires cancellation policy + customer's cancellation request communications + subscription terms
- **Visa 13.3 (Not as Described / Defective):** requires product description + refund policy + return-window evidence
- **Visa 13.4 (Counterfeit Merchandise):** requires authenticity proof + supplier records
- **Mastercard 4837 (No Cardholder Authorization):** FPT three-category evidence (Device, Delivery, Identity)
- **Mastercard 4863 (Cardholder Does Not Recognize):** FPT three-category evidence with extra emphasis on Identity

Fall back to the Shopify-enum-keyed checklist when no network-code-specific one exists.

## Admin reason-mapping UI changes

The existing internal admin reason-mapping system (`lib/db/reasonMappings.ts`, `lib/types/reasonMapping.ts`) is extended to manage **network-code-keyed** overrides alongside the existing Shopify-enum-keyed ones. Admin can:
- View the catalog (read-only — code-first)
- Override any code's `rebuttalTemplateKey` per shop (rare; mainly for edge cases)
- Trigger a re-resolution for a specific dispute when confidence is `unknown` (e.g. after manual research)

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/disputes/:disputeId/reason-code` | Returns resolved network code, confidence, and the source signal |
| POST | `/api/disputes/:disputeId/reason-code/override` | Admin-only: manually set the network code (audit-logged) |
| POST | `/api/disputes/:disputeId/reason-code/recompute` | Re-run resolver after upstream data refresh |

## UI changes (Embedded + Portal)

### Dispute detail page
- Show the network reason code prominently next to the existing Shopify-enum label, e.g. `Visa 13.1 (Merchandise/Services Not Received)` with confidence badge if not `direct`
- When confidence is `inferred` or `unknown`, show an info tooltip explaining what we used to derive it
- Admin-only "Override" link for the rare manual correction

### Rebuttal preview
- Highlight which reason-code template was used
- Allow merchant to preview alternative templates (e.g. family-level fallback) for transparency

## i18n keys

New namespace `reasonCodes.*` with:
- `code.<network>.<code>.name` (e.g. `code.visa.10_4.name`)
- `code.<network>.<code>.description`
- `family.<family>.label`
- Confidence labels (4)

Plus rebuttal-template keys keyed by network code (e.g. `rebuttal.visa.13_1.opening`, `rebuttal.visa.13_1.evidence_summary`, …).

**All 6 locales translated in the same session** (per `feedback_translate_on_add`). For the initial catalog of ~45 codes, this is the biggest translation surface in the LSE track — plan accordingly.

## Acceptance criteria

- [ ] Migration applied via `npm run db:migrate` in the same session
- [ ] `lib/disputes/reasonCodeCatalog.ts` contains the initial Visa + Mastercard catalog with metadata; unit tests cover lookups, family resolution, and shopifyEnumFallbacks consistency
- [ ] `lib/disputes/networkReasonCode.ts` exports `resolveNetworkReasonCode(input): { code, confidence, source }` with unit tests covering:
  - Shopify API returns `networkReasonCode = "10.4"` → `direct`
  - `networkReasonCode` absent, `receiptJson.reason_code = "13.1"` → `derived`
  - Both absent, Shopify enum = `PRODUCT_NOT_RECEIVED`, network = `visa` → `inferred` (best guess `13.1`)
  - Both absent, Shopify enum = `GENERAL`, network unknown → `unknown`
- [ ] Sync handler writes `network_reason_code` and confidence on dispute insert/update
- [ ] LSE-1's `qualifyCE30` reads the new field (replace any direct `dispute.reason` checks for Visa 10.4 detection)
- [ ] LSE-3's `qualifyFPT` reads the new field for Mastercard reason-code allowlisting
- [ ] `rebuttalReason.ts` switches on network code when present, falls back to Shopify enum otherwise; unit tests cover both paths
- [ ] Completeness engine returns network-code-specific checklists for at least Visa 13.1 / 13.2 / 13.3 / 10.4 and Mastercard 4837 / 4863
- [ ] Dispute detail page renders the network code with confidence badge in both embedded and portal surfaces
- [ ] Admin override flow works and writes an audit event (`network_reason_code_overridden`)
- [ ] All ~45 catalog codes have EN + PT-BR rebuttal templates; ES/FR/DE/IT may stub to English fallback in v1 (catch-up in LSE-5)
- [ ] No raw English in merchant UI (per `feedback_translate_pack_names`) — all code names go through i18n
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` all green
- [ ] `docs/technical.md` updated with §*Network Reason Code Resolution* (catalog structure, confidence model, inference fallbacks, override flow)
- [ ] Help article in `lib/help/` updated explaining "Why your dispute now shows a code like Visa 13.1"
- [ ] Verification pass in dev store + at least one production shop confirms which signal (`networkReasonCode` field vs receiptJson vs inference) is the dominant source — record findings in `docs/technical.md`

## Verification spike (must run first)

Before writing code, spend ~1 day verifying:

1. Does the current Shopify API version expose `Dispute.networkReasonCode` (or equivalent) directly? Run a real GraphQL query against a dev store dispute and a production dispute on a friendly merchant.
2. For Shopify Payments disputes, does `receiptJson` carry `reason_code` consistently? Sample 20+ disputes if available.
3. What's the realistic distribution of confidence states we'll see? If 90% of real disputes resolve to `direct` we're fine; if 90% resolve to `inferred` the value of this epic drops and we should consider a different strategy (e.g. lobbying Shopify, or making it admin-only triage).

The verification result is captured in `docs/technical.md` and informs whether to ship the inference fallback at all or to require admin tagging for unknown codes.

## Open questions

1. Does Shopify expose the network reason code on the `disputes/create` webhook payload, or only via subsequent GraphQL fetch? (Affects sync timing.)
2. Are Mastercard reason codes returned as numeric strings (`"4837"`) or with a prefix? Confirm format and normalize at resolver layer.
3. For Amex and Discover (out of LSE scope), do we still resolve and store the code for analytics, or skip entirely in v1? Recommend store-but-don't-template — minimal cost, future-proofs.
4. Should overrides be shop-scoped or DisputeDesk-staff-only? Recommend staff-only for v1 since incorrect overrides degrade rebuttal quality.
