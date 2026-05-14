# EPIC LSE-2 — CE 3.0 Evidence Package + Best-Effort Submission

> **Status:** Planned
> **Phase / week target:** Phase 2 of Liability-Shift Engine — Weeks 7–12
> **Dependencies:** EPIC LSE-1, EPIC 3 (PDF Rendering), EPIC 5 (Save to Shopify), EPIC 9 (i18n)
> **Track:** LSE (Liability-Shift Engine)
> **Source PRD:** [`docs/liability-shift-engine-prd.md`](../liability-shift-engine-prd.md) §5–§6

## Goal

Take a qualifying CE 3.0 verdict from LSE-1 and turn it into a structured, CE 3.0–formatted PDF evidence package. Then route that package through the **best channel available today**:

1. **Shopify dispute evidence API** as best-effort (`uncategorized_text` summary + `uncategorized_file` PDF) — automatic
2. **Manual acquirer handoff** workflow — merchant downloads the PDF and uploads to their acquirer's VROL portal

Direct submission via Verifi is out of scope here — that's LSE-6, gated on partnership.

## Non-goals (explicit)

- Direct Verifi or Ethoca submission (LSE-6)
- FPT package generation (LSE-3)
- Submitting via any channel other than Shopify dispute API or manual handoff
- Claiming "CE 3.0 submitted" without the routing caveat

## Architecture

```
dispute_qualifications.ce30_status = qualifies
            │
            ▼
   build_pack handler (LSE-2 hook)
            │
            ▼
   generateCE30Package(dispute, qualification)
   ├─ renderCE30HTML(template)
   ├─ puppeteer → PDF
   └─ store in supabase storage (private bucket)
            │
            ▼
   submission router
   ├─ if auto-submit-enabled → enqueue save_to_shopify
   │     with uncategorized_text = ce30 summary,
   │     uncategorized_file = ce30 pdf
   └─ in all cases → expose download + manual handoff
                     instructions to merchant
            │
            ▼
   submission_logs row written
   outcome polled later
```

**Touchpoints:**
- New module: `lib/liabilityShift/buildCE30Package.ts`
- New module: `lib/liabilityShift/submissionRouter.ts`
- Extend: `lib/jobs/handlers/buildPackJob.ts` to branch on `ce30_status = qualifies`
- Extend: `lib/jobs/handlers/saveToShopifyJob.ts` to accept CE 3.0–shaped evidence payload
- Templates: `lib/liabilityShift/templates/ce30/` (HTML + i18n)

## Package shape

Per PRD §5 — three sections:

1. **Cover & summary** — merchant, dispute, transaction, program invoked, one-line qualification statement, confidence indicator
2. **Qualification evidence table** — disputed order row + 2 prior rows + match summary with visual highlight on matches
3. **Supporting documentation** — order details, tracking, customer comms

Followed by a final **merchant statement** page asserting the customer relationship.

Templates versioned; the `evidence_packs` row records `template_version` for audit. Never include PCI-restricted data (card number, CVV).

## Submission strategy (v1 — best effort only)

For each qualifying CE 3.0 verdict:
1. **Always** submit via Shopify dispute API with the package PDF in `uncategorized_file` and a structured CE 3.0 summary in `uncategorized_text`. Shopify Payments routing of this content is unconfirmed — that's the open question driving the partnership conversations.
2. **Always** offer a download link and acquirer-handoff instructions inside the embedded app. Copy: "DisputeDesk has generated a CE 3.0-formatted evidence package and submitted it through Shopify. For maximum effect, you can also upload this package directly to your acquirer's dispute portal."
3. **Always** record a `submission_logs` row per channel so we can measure win-rate per channel and justify (or kill) LSE-6.

Coverage Gate (CLAUDE.md non-negotiable): a covered pack still short-circuits before any LSE-2 work — covered disputes do not receive a CE 3.0 package.

## Database changes

New migration: `supabase/migrations/NNN_lse_evidence_and_submissions.sql`

### Extend `evidence_packs`

| Column | Type | Description |
|--------|------|-------------|
| `package_type` | text | `ce_30`, `standard_representment` (default), later `fpt` (LSE-3) |
| `template_version` | text | e.g. `ce30-v1` |
| `qualification_id` | uuid FK → dispute_qualifications nullable | |
| `language` | text | one of the 6 supported locales |

### New table: `submission_logs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | |
| `shop_id` | uuid FK | |
| `evidence_pack_id` | uuid FK | |
| `channel` | text | `shopify_dispute_api`, `manual_acquirer`, later `verifi`, `ethoca` |
| `submitted_at` | timestamptz | |
| `confirmation_id` | text nullable | channel-specific |
| `raw_response` | jsonb nullable | |
| `final_outcome` | text | `pending`, `won`, `lost`, `withdrawn`, `unknown` |
| `outcome_recorded_at` | timestamptz nullable | |
| `notes` | text nullable | |

Indexes: `(shop_id, channel, final_outcome)`, `(evidence_pack_id, channel)` unique.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/packs/:packId/download?type=ce30` | Signed URL for the CE 3.0 PDF |
| POST | `/api/packs/:packId/mark-submitted` | Merchant logs a manual-acquirer submission with optional `confirmation_id` |
| POST | `/api/packs/:packId/outcome` | Update final outcome (won / lost / withdrawn) per channel |

## UI changes (Embedded + Portal)

### Dispute detail page (LSE-1 panel evolves)
- For `qualifies-high` / `qualifies-low`: show **CE 3.0 package ready** card
  - Download button
  - "Submitted via Shopify" timestamp (auto)
  - "I uploaded this to my acquirer" toggle → opens manual-submission modal
- For `partial`: show only "Not enough evidence for CE 3.0 — fall back to standard pack"

### Pack-builder polish
- Pack list view shows a `CE 3.0` badge on qualifying packs
- Sorting/filtering by `package_type`

### Settings
- Toggle: `Auto-submit CE 3.0 packages via Shopify` (default ON)
- Toggle: `Always also show manual acquirer instructions` (default ON, can be disabled when LSE-6 makes direct submission available)

## Localization (per `feedback_translate_pack_names` and `feedback_translate_on_add`)

EN + PT-BR templates in v1 (per PRD §10 Phase 2). Other 4 locales scaffolded but English fallback acceptable until LSE-5. Pack type label rendered via i18n key `packs.disputeTypeLabel.ce_30`, never raw `ce_30`. Translate any new merchant-facing string across all 6 locales when added.

## Acceptance criteria

- [ ] Migration applied via `npm run db:migrate` in the same session
- [ ] `lib/liabilityShift/buildCE30Package.ts` exports `buildCE30Package(qualification): EvidencePackBuildResult`
- [ ] PDF renders with the §5 layout; visual snapshot test passes in EN and PT-BR
- [ ] On a qualifying dispute, `save_to_shopify` job runs with `uncategorized_text` and `uncategorized_file` populated; verified on a dev store
- [ ] `submission_logs` row written for both auto Shopify submission and manual handoffs
- [ ] Merchant can download the PDF and mark a manual submission from the embedded app
- [ ] Win/loss outcome capture flow works end-to-end on at least one dev-store dispute
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` all green
- [ ] `docs/technical.md` updated with §*CE 3.0 Evidence Package* and §*Submission Router (v1)*
- [ ] Help article in `lib/help/` updated with "Why we also recommend uploading manually to your acquirer"
- [ ] Copy review: nothing claims "CE 3.0 submitted to Visa" — only "CE 3.0 package generated and sent via Shopify"
