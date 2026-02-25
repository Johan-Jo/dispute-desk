# EPIC 5 — Save Evidence to Shopify

> **Status:** Done
> **Week:** 4
> **Dependencies:** EPIC 0, EPIC 2

## Goal

Push structured evidence fields from the internal pack back to Shopify's dispute record via GraphQL. Clear UX: "save," never "submit."

## Implementation

### 5.1 — Shopify Evidence Field Mapping

`lib/shopify/fieldMapping.ts` — mapping engine:

- `FIELD_MAPPINGS` array maps internal pack section keys to `DisputeEvidenceUpdateInput` fields.
- `buildEvidenceInput(sections, disabledFields?)` — builds the Shopify mutation input from pack sections. Only includes fields with non-empty content. Supports disabling individual fields.
- `previewEvidenceMapping(sections)` — returns a preview of what would be sent per Shopify field.

| Shopify Field | Internal Section Keys |
|---------------|----------------------|
| `shippingDocumentation` | fulfillment, tracking, shipping |
| `accessActivityLog` | timeline, order_activity, access_log |
| `cancellationPolicyDisclosure` | cancellation_policy, refund_policy |
| `refundPolicyDisclosure` | refund_policy_snapshot, refund_policy |
| `refundRefusalExplanation` | refund_refusal |
| `cancellationRebuttal` | cancellation_rebuttal |
| `customerCommunication` | customer_comms, customer_communication |
| `uncategorizedText` | notes, additional, uncategorized |

### 5.2 — Save-to-Shopify API Route

`POST /api/packs/:packId/save-to-shopify`:

1. Validates pack exists and dispute has `dispute_evidence_gid`.
2. Enqueues a `save_to_shopify` job.
3. Sets pack status to `saving`.
4. Logs audit event and returns `202 Accepted`.

### 5.3 — Job Handler (save_to_shopify)

`lib/jobs/handlers/saveToShopifyJob.ts`:

1. Loads pack sections, dispute evidence GID, and offline session.
2. Decrypts access token.
3. Builds `DisputeEvidenceUpdateInput` via `buildEvidenceInput()`.
4. Calls `disputeEvidenceUpdate` GraphQL mutation with evidence GID.
5. On success: updates pack to `saved_to_shopify` with timestamp.
6. On `userErrors`: updates pack to `save_failed`, logs errors.
7. All steps logged via `audit_events`.

### 5.4 — Save Evidence UI

**Embedded App** (`app/(embedded)/app/packs/[packId]/page.tsx`):

- "Save Evidence to Shopify" card with primary button.
- States: saving, save_failed (retry), saved_to_shopify (success + deep-link).
- Disabled while pack is building/queued.

**Portal** (`app/(portal)/portal/packs/[packId]/page.tsx`):

- Identical functionality with Tailwind CSS styling.
- Success state shows green checkmark + link to Shopify Admin.

### 5.5 — UX Copy Compliance

- All labels use "Save evidence" language.
- Info text: "Saves structured evidence fields to Shopify via API. Submission to the card network happens in Shopify Admin."
- Never: "Submit response", "Submit to card network", "File dispute response".

### 5.6 — Mutation (Pre-existing)

`lib/shopify/mutations/disputeEvidenceUpdate.ts` was scaffolded in EPIC 0:

- `disputeEvidenceUpdate` mutation with `$id` (evidence GID) and `$input`.
- TypeScript interfaces for input and result types.

## Key Files

| File | Purpose |
|------|---------|
| `lib/shopify/fieldMapping.ts` | Pack section → Shopify field mapping engine |
| `lib/shopify/mutations/disputeEvidenceUpdate.ts` | GraphQL mutation + types |
| `app/api/packs/[packId]/save-to-shopify/route.ts` | Enqueue save job |
| `lib/jobs/handlers/saveToShopifyJob.ts` | Job handler: build input, call mutation |
| `app/(embedded)/app/packs/[packId]/page.tsx` | Save button + status UI (Polaris) |
| `app/(portal)/portal/packs/[packId]/page.tsx` | Save button + status UI (Tailwind) |
| `tests/unit/fieldMapping.test.ts` | Unit tests for field mapping |

## Acceptance Criteria

- [x] `disputeEvidenceUpdate` called with evidence GID and offline session.
- [x] Field mapping engine maps pack sections to Shopify input fields.
- [x] Audit log records fields sent + any userErrors.
- [x] No UI copy claims programmatic submission.
- [x] Deep-link to Shopify Admin works.
- [x] `userErrors` surface as `save_failed` status with audit log details.

## Permissions Note

Saving evidence requires the merchant user to have **"Manage orders information"** in Shopify Admin (Settings > Plan and permissions). This is a Shopify Admin permission, not an OAuth scope.
