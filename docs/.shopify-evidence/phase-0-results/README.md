# Phase 0 — Conditional file evidence layer: probe results

**Run date:** 2026-05-03
**Shop:** `surasvenne.myshopify.com` (dev store)
**Dispute used:** `gid://shopify/ShopifyPaymentsDispute/10519937081` (status `NEEDS_RESPONSE`, reason `FRAUDULENT`)
**API version:** `2026-01`

## TL;DR

The new `read/write_shopify_payments_dispute_file_uploads` scopes (added in commit `f61176c`) **fully unlock** the REST `/dispute_file_uploads.json` endpoint. The earlier dead-code claim ("404 / endpoint not reachable from third-party apps", documented in `lib/shopify/disputeFileUpload.ts` pre-rewrite) was based on a token without the new scope — it was **never** a structural block.

All five Phase 0 acceptance criteria below are green from the API side. The remaining **0c (visual UI verification)** is a hands-on step the maintainer must complete on the Shopify Admin → Payments → Chargeback response screen — see `_PENDING_0c_VISUAL_VERIFICATION.md` in this directory.

## 0a. REST upload returns 200 + file id

`POST /admin/api/2026-01/shopify_payments/disputes/:numericId/dispute_file_uploads.json`

| `document_type` | HTTP | File id format |
|---|---|---|
| `customer_communication_file` | 200 | numeric (10 digits) |
| `refund_policy_file` | 200 | numeric |
| `cancellation_policy_file` | 200 | numeric |
| `uncategorized_file` | 200 | numeric |
| `shipping_documentation_file` | 200 | numeric |
| `service_documentation_file` | 200 | numeric |

The earlier 422 reply `"document_type must be one of customer_communication_file, ..."` made the lowercase `snake_case` enum explicit. Sending the old `UNCATEGORIZED_FILE` (uppercase) returns 422 — the only legal casing is `lower_snake_case`.

Captured raw output: `probe-2026-05-03T19-02-10-971Z.json`.

## 0b. `disputeEvidenceUpdate` accepts the GID on each named file field

For each upload, we wrapped `gid://shopify/ShopifyPaymentsDisputeFileUpload/{id}` and ran:

```graphql
mutation($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
  disputeEvidenceUpdate(id: $id, input: $input) {
    disputeEvidence { id }
    userErrors { field message }
  }
}
```

| `document_type` (REST) | mutation input field | `userErrors` |
|---|---|---|
| `customer_communication_file` | `customerCommunicationFile` | `[]` |
| `refund_policy_file` | `refundPolicyFile` | `[]` |
| `cancellation_policy_file` | `cancellationPolicyFile` | `[]` |
| `uncategorized_file` | `uncategorizedFile` | `[]` |
| `shipping_documentation_file` | `shippingDocumentationFile` | `[]` |
| `service_documentation_file` | `serviceDocumentationFile` | `[]` |

**The 1:1 mapping is canonical** — Shopify treats each `document_type` as bound to its matching `*File` field. We have not tested cross-mapping (e.g. uploading as `shipping_documentation_file` and attaching to `customerCommunicationFile`); the helper enforces the mapping via `DOCUMENT_TYPE_TO_MUTATION_FIELD`.

## 0c. Visual UI verification — **DONE (2026-05-03)**

Maintainer ran Phase 0c against dispute `10519937081` (`FRAUDULENT`) immediately after the API probes. Two material findings beyond "files attach":

### 0c-finding-1 — UI rendering is reason-aware

For `FRAUDULENT` only **four** `*File` rows render in *Additional evidence*:

| Visible row | Mutation field |
|---|---|
| Customer communication | `customerCommunicationFile` |
| Shipping documentation | `shippingDocumentationFile` |
| Proof of service | `serviceDocumentationFile` |
| Any other evidence that supports your case | `uncategorizedFile` |

`refundPolicyFile` and `cancellationPolicyFile` are **absent** — the API still accepts them with empty `userErrors`, but the merchant UI never displays them on a fraud dispute. They presumably surface for refund / subscription cancellation reasons (not yet probed; expected per dispute-reason-family logic).

**Phase 2 implication:** `decideFileAttachments` must filter `targetField` candidates by dispute reason. Populating a hidden slot via API "succeeds" on every layer except the only one that matters (the merchant + issuer view).

### 0c-finding-2 — UI size cap is 2 MB, not 4 MB

Admin's upload modal states verbatim: *"Must be a .png, .jpg, .pdf and be smaller than 2 MB."* The REST API accepts up to ~3.81 MiB (Phase 0e), but anything between 2 MiB and the API ceiling renders inconsistently in the UI. The helper now pins **`MAX_FILE_SIZE_BYTES = 2_097_152`** (2 MiB) — UI ceiling wins.

### 0c-finding-3 — JPEG render confirmed (1×1 pixel was the issue)

Initial 1×1 black-pixel JPEG (327 bytes) attached but failed to preview via the 👁️ icon. Re-uploaded a realistic 43 KB photographic JPEG (project screenshot converted via `sharp`) into `customer_communication_file` — preview now renders the actual image inside Admin's upload modal. JPEG support is fine; tiny test images were the cause. See `realistic-jpeg-uploaded.jpg` and `scripts/phase-0-realistic-jpeg.mjs`.

### Captured artefacts in this directory

- `realistic-jpeg-uploaded.jpg` — exact bytes of the realistic JPEG that rendered correctly.
- (Maintainer's screenshots showing the populated rows + the working preview were reviewed 2026-05-03 but not committed to the repo.)

## 0d. Read-back behavior

The GraphQL `dispute → disputeEvidence → *File { id }` query **returns the same GIDs we set**. All six file fields are readable on a verified dispute:

```json
{
  "disputeEvidence": {
    "uncategorizedFile":          { "id": "gid://shopify/ShopifyPaymentsDisputeFileUpload/8421998649" },
    "cancellationPolicyFile":     { "id": "gid://shopify/ShopifyPaymentsDisputeFileUpload/8421965881" },
    "customerCommunicationFile":  { "id": "gid://shopify/ShopifyPaymentsDisputeFileUpload/8421900345" },
    "refundPolicyFile":           { "id": "gid://shopify/ShopifyPaymentsDisputeFileUpload/8421933113" },
    "serviceDocumentationFile":   { "id": "gid://shopify/ShopifyPaymentsDisputeFileUpload/8422064185" },
    "shippingDocumentationFile":  { "id": "gid://shopify/ShopifyPaymentsDisputeFileUpload/8422031417" }
  }
}
```

**Implication for v2 plan:** the plan's "file fields are write-only / diff-exempt" assumption is **wrong**. File fields are fully verifiable via GID equality — when Phase 3 wires `verifyEvidenceReadback`, file-field input keys should classify as `confirmed` if the read-back GID matches what was sent, `missing` otherwise. This is an **upgrade** over the original plan: we get stronger verification, not weaker.

REST list endpoint `GET /shopify_payments/disputes/:id/dispute_file_uploads.json` returns **404** — there is no public GET equivalent. Read-back must use GraphQL.

## 0e. MIME + size limits

Captured raw output: `mime-limits-2026-05-03T19-03-43-355Z.json`.

| Variant | Bytes | Declared MIME | Result |
|---|---|---|---|
| Valid JPEG (1×1 black) | 327 | `image/jpeg` | **200** + file id |
| Valid PNG (1×1 transparent) | 70 | `image/png` | **200** + file id |
| Valid PDF (programmatic, correct xref) | 559 | `application/pdf` | **200** + file id |
| Corrupt PDF (broken header) | 39 | `application/pdf` | **422** — *"mimetype must be one of image/jpg, image/jpeg, image/png, application/pdf"* (Shopify content-sniffs and rejects; the error text is misleading — declared MIME was correct) |
| 10 MiB blob | 10,485,760 | `image/png` | **422** — *"You can upload up to 4MB and your last file uploaded surpassed this limit. Please upload a file smaller than 3997806 bytes."* |

**Helper constants** (`lib/shopify/disputeFileUpload.ts`):

- `ACCEPTED_MIME_TYPES = { "image/jpg", "image/jpeg", "image/png", "application/pdf" }`
- `MAX_FILE_SIZE_BYTES = 3_997_806`

Both validated client-side before hitting Shopify so callers fail fast on predictable input errors.

## What ships in this PR (Phase 0 deliverables)

- `scripts/phase-0-file-evidence.mjs` — REST + GraphQL E2E probe (per-field).
- `scripts/phase-0-mime-limits.mjs` — MIME + size variants probe.
- `scripts/probe-rest-file-upload.mjs` — minimal probe (kept; lowercase fix in commit history).
- `lib/shopify/disputeFileUpload.ts` — **rewritten** as real `uploadDisputeFile` helper with input validation, error discriminator, request-id propagation. **Not called from any production path yet** — Phase 3 wires it.
- `lib/shopify/__tests__/disputeFileUpload.test.ts` — 12 unit tests (validation + response handling, no network).
- `docs/.shopify-evidence/phase-0-results/` — captured probe runs + this README.
- `docs/technical.md` — *File evidence path* section updated.
- `docs/plans/conditional_file_evidence_layer.plan.md` — Phase 0 outcomes recorded; v2 read-back assumption corrected.

## What does NOT ship (Phase 0 boundary)

- `saveToShopifyJob` is unchanged. Today's evidence still ships as text + DisputeDesk-hosted links inside `uncategorizedText`.
- `verifyEvidenceReadback` is unchanged. The query gains file fields in Phase 3, when the production path actually starts sending them.
- The feature flag `file_evidence_attachments_enabled` is not yet defined. Phases 1–7 add it.
