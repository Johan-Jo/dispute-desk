# EPIC LSE-3 — Mastercard FPT Readiness

> **Status:** Planned
> **Phase / week target:** Phase 3 of Liability-Shift Engine — Weeks 13–18
> **Dependencies:** EPIC LSE-1, EPIC LSE-2
> **Track:** LSE (Liability-Shift Engine)
> **Source PRD:** [`docs/liability-shift-engine-prd.md`](../liability-shift-engine-prd.md) §2, §4 (FPT logic), §5 (FPT package)

## Goal

Extend the LSE platform to the Mastercard side: for every Mastercard first-party-fraud dispute in an FPT-eligible region, evaluate **readiness** across three categories (Device, Delivery, Identity), generate an FPT-formatted evidence package, and route through the best-available channel (Shopify dispute API best-effort + manual handoff). Direct Ethoca submission is **out of scope** here — that's LSE-6.

FPT is more permissive than CE 3.0: it does not require prior transactions, but it does require evidence across all three FPT categories with non-trivial strength.

## Non-goals (explicit)

- Ethoca Consumer Clarity direct integration (LSE-6)
- Mastercard 3DS Identity Check Insights pre-auth submission — structurally unavailable to a Shopify app
- Calibrating FPT category scoring against real outcomes (post-Phase 3 data work)
- Subscription-specific FPT rules
- B2B FPT patterns

## Architecture

```
dispute synced → runAutomationPipeline
                       │
                       ▼
              evaluateQualification (LSE-1 module, now FPT-aware)
              ├─ if visa + 10.4 → ce30 path (LSE-1)
              └─ if mastercard + fpt-reason-code + fpt-region
                   → readyForFPT(dispute, sessionData?)
                       ├─ score device category
                       ├─ score delivery category
                       └─ score identity category

                       │ writes dispute_qualifications row
                       │ (program_evaluated may now be `fpt` or `both`)
                       ▼
              build_pack handler
                       │
                       ├─ ce30 branch (LSE-2)
                       └─ fpt branch (new)
                              └─ buildFPTPackage(qualification)
                                    └─ submissionRouter (LSE-2 module)
                                          ├─ shopify_dispute_api
                                          └─ manual_acquirer
```

**Touchpoints:**
- Extend: `lib/liabilityShift/qualifyCE30.ts` becomes `lib/liabilityShift/qualify.ts` with `qualifyCE30` and `qualifyFPT` exports
- New module: `lib/liabilityShift/qualifyFPT.ts`
- New module: `lib/liabilityShift/buildFPTPackage.ts`
- New module: `lib/liabilityShift/fptCategories.ts` (Device/Delivery/Identity scorers)
- Reuse: `submissionRouter` from LSE-2 with `package_type = fpt`

## FPT readiness logic

See PRD §4 for the canonical pseudocode. In words:

> Card network must be Mastercard **and** reason code must be on the FPT-eligible list **and** merchant region must be in the FPT availability set (US since 2024-10; LATAM incl. Brazil, Canada, Caribbean, APAC since 2025-06). Then evaluate three categories independently:

- **Device** — IP address, user agent, device fingerprint (if LSE-4 data exists), session behavior, login state. Score 0–1.
- **Delivery** — Tracking, delivery confirmation, signature, shipping address validation. Score 0–1.
- **Identity** — Customer account age, account login state at checkout, billing address match, email tenure, repeat-customer signal. Score 0–1.

**Verdict** = `ready` when (a) all three category scores > 0, AND (b) sum ≥ 2.0. Otherwise `partial` or `not_ready`.

Scoring thresholds in v1 are conservative and intentionally rough — we don't have submission outcomes to tune against yet (see Open Question #6 in PRD §11). Encode thresholds as named constants (`lib/liabilityShift/fptThresholds.ts`) so they're cheap to update later.

### Reason-code allowlist

FPT applies to Mastercard CNP first-party-fraud disputes. The eligible reason codes (Mastercard reason code 4837 "No Cardholder Authorization" and 4863 "Cardholder Does Not Recognize" being the most common) are encoded in `lib/liabilityShift/fptReasonCodes.ts`. Update on Mastercard rule changes.

### Region eligibility

FPT region eligibility encoded in `lib/liabilityShift/fptRegions.ts`:
- Always: US
- Since 2025-06: Canada, LATAM (BR, MX, AR, CL, CO, PE, etc.), Caribbean, APAC
- Not yet: EU (TBD by Mastercard)

Region is derived from `merchant.country_code` (Shopify shop record).

## Database changes

Migration: `supabase/migrations/NNN_lse_fpt.sql`

### Extend `dispute_qualifications` (built in LSE-1, extended here)

| Column | Type | Description |
|--------|------|-------------|
| `program_evaluated` | text | Now can be `fpt` or `both`; LSE-1 only set `ce_30` or `none` |
| `fpt_status` | text | `ready`, `partial`, `not_ready`, `not_applicable` |
| `fpt_category_scores` | jsonb | `{device: float, delivery: float, identity: float}` |
| `fpt_eligible_region` | boolean | snapshot at evaluation time |
| `fpt_reason_code_match` | boolean | snapshot at evaluation time |

### Extend `evidence_packs`

`package_type` enum already widened in LSE-2; now FPT generates rows with `package_type = 'fpt'`. No schema change.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/disputes/:disputeId/qualification` | Already exposed in LSE-1 — now returns FPT block too |
| GET | `/api/packs/:packId/download?type=fpt` | Signed URL for the FPT PDF |

## Package shape (FPT-specific)

PRD §5 — same overall structure as CE 3.0, with the evidence-table page replaced:

**Page 2 — Three-Category Evidence Table**
- **Device** row: IP, user agent, fingerprint hash if available, session start time, login state, with each evidence type labeled with its score contribution
- **Delivery** row: tracking number + carrier, delivery confirmation timestamp, signature image link, shipping address validation result
- **Identity** row: account age, account login state at checkout, billing address match, email tenure, repeat-customer status

Supporting documentation page lists the underlying artifacts (tracking screenshots, login event logs, prior order list).

Templates: `lib/liabilityShift/templates/fpt/` (HTML + i18n keys).

## UI changes

### Dispute detail page (LSE-1 panel evolves further)
When a dispute is Mastercard + FPT-eligible:
- Show **FPT readiness** card alongside (or instead of) CE 3.0 card
- Three category scores rendered as horizontal bars
- For `ready`: download + manual submission flow (mirrors LSE-2)
- For `partial`: missing-evidence list per category
- For `not_ready`: muted with reason
- For `not_applicable` (e.g., wrong region): muted with copy "FPT not yet available in {region}"

### Settings
- Toggle: `Auto-submit FPT packages via Shopify` (default ON)
- Read-only "FPT regional status: Available / Not yet" derived from shop country

## i18n keys

New namespace `liabilityShift.fpt.*`. Add keys for: category labels (3), score-band labels (4: very-weak/weak/medium/strong), missing-evidence codes per category, verdict labels. Translate across all 6 locales in the same session.

`packs.disputeTypeLabel.fpt` for the pack-name display.

## Acceptance criteria

- [ ] Migration applied via `npm run db:migrate` in the same session
- [ ] `lib/liabilityShift/qualifyFPT.ts` exports `qualifyFPT(input): FPTResult` with unit tests covering:
  - Mastercard + eligible reason + US region + strong evidence in all three categories → `ready`
  - Mastercard + eligible reason + EU region → `not_applicable` (`region_not_yet_available`)
  - Visa + 10.4 → `not_applicable` (`wrong_network`)
  - Mastercard + eligible reason + zero device evidence → `partial` (`device_category_empty`)
  - Mastercard + eligible reason + all categories present but sum < 2.0 → `partial` (`overall_too_weak`)
  - Brazil region + 2025-07 dispute date → eligible
  - Brazil region + 2025-05 dispute date → `not_applicable` (pre-LATAM launch)
- [ ] Pipeline writes FPT verdict to `dispute_qualifications` for every Mastercard dispute in scope
- [ ] FPT package PDF renders with §5 layout, EN + PT-BR
- [ ] `submission_logs` row written for both Shopify auto-submit and manual handoff
- [ ] Dispute detail page renders the FPT readiness card with category breakdown
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` all green
- [ ] `docs/technical.md` updated with §*FPT Readiness Engine* and §*FPT Evidence Package*
- [ ] Help article in `lib/help/` explaining "What is Mastercard First-Party Trust?" and "Why we're not submitting directly to Mastercard yet"
- [ ] Copy review: nothing claims "FPT submitted to Mastercard" — only "FPT-formatted package generated"

## Open questions (PRD §11) revisited at end of phase

- #6 FPT scoring calibration — by end of Phase 3 we have zero or near-zero outcome data; design the data pipeline to start capturing it now
- #4–#5 Ethoca / Verifi partnership status — checkpoint before designing LSE-6
