# EPIC 5 — Save Evidence to Shopify

> **Status:** Pending
> **Week:** 4
> **Dependencies:** EPIC 0, EPIC 2

## Goal

Push structured evidence fields from the internal pack back to Shopify's dispute record via GraphQL. Clear UX: "save," never "submit."

## Tasks

### 5.1 — Shopify Evidence Field Mapping
- `lib/shopify/mutations/disputeEvidenceUpdate.ts` — `disputeEvidenceUpdate` GraphQL mutation.
- Map pack sections to `DisputeEvidenceUpdateInput` fields:
  - `accessActivityLog` — order timeline events.
  - `cancellationPolicyDisclosure` — refund policy snapshot.
  - `cancellationRebuttal` — merchant-authored (not auto-filled).
  - `customerCommunication` — manual uploads or comms.
  - `refundPolicyDisclosure` — policy snapshot.
  - `refundRefusalExplanation` — merchant-authored.
  - `shippingDocumentation` — fulfillment/tracking data.
  - `uncategorizedText` — catch-all.
- `lib/shopify/fieldMapping.ts` — mapping config with toggle support.

### 5.2 — Save-to-Shopify API Route
- `POST /api/packs/:packId/save-to-shopify`:
  1. Load pack + dispute. Requires `dispute_evidence_gid`.
  2. Requires **online session** (user-context).
  3. Build `DisputeEvidenceUpdateInput` from sections.
  4. Call mutation with evidence GID (NOT dispute GID).
  5. Handle `userErrors`.
  6. Log `audit_events`: `event_type: evidence_saved_to_shopify`.
  7. Update `last_saved_to_shopify_at`.

### 5.3 — Save Evidence UI
- "Save Evidence to Shopify" button on pack preview.
- Review modal before save:
  - Left: internal pack sections. Right: Shopify evidence field mapping.
  - Toggle on/off, edit text fields.
- After save:
  - Green check per saved field. Timestamp.
  - Deep-link: "Open in Shopify Admin to review and finalize."

### 5.4 — UX Copy Compliance
- All labels use "Save evidence" language.
- Never: "Submit response", "Submit to card network", "File dispute response".
- Info banner: "Shopify will submit your evidence by the dispute due date, or you can submit manually in Shopify Admin."

## Key Files
- `lib/shopify/mutations/disputeEvidenceUpdate.ts`
- `lib/shopify/fieldMapping.ts`
- `app/api/packs/[packId]/save-to-shopify/route.ts`
- `app/packs/[packId]/page.tsx` (save UI, mapping review, deep-link)

## Acceptance Criteria
- [ ] `disputeEvidenceUpdate` called with evidence GID and online session.
- [ ] Saved evidence visible in Shopify Admin.
- [ ] Audit log records fields sent + any userErrors.
- [ ] No UI copy claims programmatic submission.
- [ ] Deep-link to Shopify Admin works.
- [ ] `userErrors` displayed clearly to merchant.

## Permissions Note
Saving evidence requires the merchant user to have **"Manage orders information"** in Shopify Admin (Settings > Plan and permissions). This is a Shopify Admin permission, not an OAuth scope. If missing, the mutation will return an access error.
