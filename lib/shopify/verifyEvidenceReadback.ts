/**
 * Read-back verification for save-to-shopify (Phase 2.3 step 2).
 *
 * After `disputeEvidenceUpdate` succeeds, the production handler
 * re-queries the dispute's evidence node and compares each
 * just-sent field against what Shopify returned. The result is
 * persisted in the audit event's `verification` payload and drives
 * the final pack status (`saved_to_shopify_verified` vs
 * `saved_to_shopify_unverified`).
 *
 * Two exports:
 *   - `diffVerificationReadback`: PURE function — given the input
 *     keys + Shopify's evidence node, classifies each key as
 *     confirmed / missing / write_only. Pinned by
 *     `lib/jobs/handlers/__tests__/saveToShopify.snapshot.test.ts`.
 *   - `verifyEvidenceReadback`: orchestration — issues the GraphQL
 *     query, normalizes the response shape, and runs the diff.
 *     Returns `null` (instead of throwing) when the read fails so
 *     the caller can record the diff as "unverified" in audit
 *     without aborting the save flow.
 *
 * Verifiable fields are the seven readable text columns on
 * `disputeEvidence`. Write-only fields (`submitEvidence`,
 * `customerFirstName`, `customerLastName`) are accepted by the
 * mutation but never come back through the read API; they MUST
 * land in `fields_write_only` and never as missing.
 */

import { requestShopifyGraphQL } from "./graphql";

/* ── Query + field allowlists ───────────────────────────────── */

/**
 * Verification query — reads back evidence fields from Shopify.
 *
 * Text fields verify by non-empty value (Shopify echoes the same string we
 * sent). File fields verify by GID equality — Phase 0d (2026-05-03)
 * confirmed `disputeEvidence.*File.id` is fully readable on all six
 * named slots, so when `saveToShopifyJob` sends a `*File` field with
 * a GID, the read-back must return the same GID or we treat it as
 * unverified.
 */
export const VERIFY_EVIDENCE_QUERY = `
  query VerifyEvidence($id: ID!) {
    node(id: $id) {
      ... on ShopifyPaymentsDispute {
        disputeEvidence {
          id
          accessActivityLog
          cancellationPolicyDisclosure
          cancellationRebuttal
          customerEmailAddress
          refundPolicyDisclosure
          refundRefusalExplanation
          uncategorizedText
          shippingDocumentationFile { id }
          customerCommunicationFile { id }
          serviceDocumentationFile { id }
          uncategorizedFile { id }
          refundPolicyFile { id }
          cancellationPolicyFile { id }
        }
      }
    }
  }
`;

/** Text fields that are readable via the Shopify API for verification. */
export const VERIFIABLE_FIELDS: ReadonlySet<string> = new Set([
  "accessActivityLog",
  "cancellationPolicyDisclosure",
  "cancellationRebuttal",
  "customerEmailAddress",
  "refundPolicyDisclosure",
  "refundRefusalExplanation",
  "uncategorizedText",
]);

/** File fields verified by GID equality (Phase 0d / Phase 3). */
export const VERIFIABLE_FILE_FIELDS: ReadonlySet<string> = new Set([
  "shippingDocumentationFile",
  "customerCommunicationFile",
  "serviceDocumentationFile",
  "uncategorizedFile",
  "refundPolicyFile",
  "cancellationPolicyFile",
]);

/** Fields that are write-only (mutation accepts but can't be verified via read-back). */
export const WRITE_ONLY_FIELDS: ReadonlySet<string> = new Set([
  "submitEvidence",
  "customerFirstName",
  "customerLastName",
]);

interface VerifyEvidenceResult {
  node: {
    disputeEvidence: {
      id: string;
      accessActivityLog: string | null;
      cancellationPolicyDisclosure: string | null;
      cancellationRebuttal: string | null;
      customerEmailAddress: string | null;
      refundPolicyDisclosure: string | null;
      refundRefusalExplanation: string | null;
      uncategorizedText: string | null;
      shippingDocumentationFile: { id: string } | null;
      customerCommunicationFile: { id: string } | null;
      serviceDocumentationFile: { id: string } | null;
      uncategorizedFile: { id: string } | null;
      refundPolicyFile: { id: string } | null;
      cancellationPolicyFile: { id: string } | null;
    } | null;
  } | null;
}

/* ── Pure diff ──────────────────────────────────────────────── */

export interface VerificationDiff {
  fields_sent: string[];
  fields_confirmed: string[];
  fields_missing: string[];
  fields_write_only: string[];
  verified: boolean;
}

export type VerificationDiffOrError =
  | VerificationDiff
  | { error: string };

export interface DiffVerificationInput {
  /** Keys present on the `DisputeEvidenceUpdateInput` we just sent. */
  inputKeys: string[];
  /** The `disputeEvidence` node Shopify returned, or `null` when the
   *  read failed. */
  evidenceFromShopify: Record<string, unknown> | null;
  /** Optional original input — needed for file-field GID-equality
   *  verification. When omitted, file fields fall through to
   *  `fields_write_only` (backwards compat with text-only callers and
   *  the existing snapshot tests). */
  inputValues?: Record<string, unknown>;
}

/**
 * Classify each just-sent field against the read-back response.
 *
 *   - WRITE_ONLY_FIELDS → fields_write_only (mutation accepts, read API
 *     doesn't expose).
 *   - VERIFIABLE_FIELDS with a non-empty string in the response →
 *     fields_confirmed.
 *   - VERIFIABLE_FIELDS with empty/missing in the response →
 *     fields_missing.
 *   - Anything else (unmapped keys) → fields_write_only as well, since
 *     the read API can't see them either.
 *
 * `verified === true` iff `fields_missing` is empty.
 */
export function diffVerificationReadback(
  args: DiffVerificationInput,
): VerificationDiffOrError {
  const { inputKeys, evidenceFromShopify, inputValues } = args;
  if (!evidenceFromShopify) {
    return { error: "Could not fetch evidence from Shopify" };
  }
  const fieldsConfirmed: string[] = [];
  const fieldsMissing: string[] = [];
  const fieldsWriteOnly: string[] = [];

  for (const key of inputKeys) {
    if (WRITE_ONLY_FIELDS.has(key)) {
      fieldsWriteOnly.push(key);
      continue;
    }

    if (VERIFIABLE_FILE_FIELDS.has(key)) {
      // File fields verify by GID equality. Only meaningful when the
      // caller passes the original `inputValues`; without it, fall
      // through to write-only (preserves prior snapshot test
      // behaviour for callers that don't supply file values).
      if (!inputValues) {
        fieldsWriteOnly.push(key);
        continue;
      }
      const sentValue = inputValues[key];
      const sentGid =
        sentValue && typeof sentValue === "object" && "id" in (sentValue as object)
          ? (sentValue as { id?: unknown }).id
          : null;
      const echoed = evidenceFromShopify[key];
      const echoedGid =
        echoed && typeof echoed === "object" && "id" in (echoed as object)
          ? (echoed as { id?: unknown }).id
          : null;
      if (
        typeof sentGid === "string" &&
        typeof echoedGid === "string" &&
        sentGid === echoedGid
      ) {
        fieldsConfirmed.push(key);
      } else {
        fieldsMissing.push(key);
      }
      continue;
    }

    if (!VERIFIABLE_FIELDS.has(key)) {
      fieldsWriteOnly.push(key);
      continue;
    }
    const shopifyValue = evidenceFromShopify[key];
    if (typeof shopifyValue === "string" && shopifyValue.trim().length > 0) {
      fieldsConfirmed.push(key);
    } else {
      fieldsMissing.push(key);
    }
  }

  return {
    fields_sent: inputKeys,
    fields_confirmed: fieldsConfirmed,
    fields_missing: fieldsMissing,
    fields_write_only: fieldsWriteOnly,
    verified: fieldsMissing.length === 0,
  };
}

/* ── Orchestration: query Shopify + diff ───────────────────── */

export interface VerifyEvidenceReadbackInput {
  shopDomain: string;
  accessToken: string;
  /** The dispute GID (NOT the dispute_evidence GID — verification
   *  reads the evidence as a nested field on the dispute node). */
  disputeGid: string;
  /** Keys on the `DisputeEvidenceUpdateInput` we sent. */
  inputKeys: string[];
  /** Optional original input — required to verify file fields by GID
   *  equality. Text-only callers can omit it. */
  inputValues?: Record<string, unknown>;
  /** Optional correlation id for the GraphQL request. */
  correlationId?: string;
}

/**
 * Issue the verification GraphQL query and run the diff. Returns
 * `null` when the response shape is unexpected so the caller can
 * record the diff as `{ error: "..." }` in audit without aborting
 * the save. Network-level errors propagate (caller should catch).
 */
export async function verifyEvidenceReadback(
  args: VerifyEvidenceReadbackInput,
): Promise<{
  diff: VerificationDiffOrError;
  evidenceNode: Record<string, unknown> | null;
}> {
  const { shopDomain, accessToken, disputeGid, inputKeys, inputValues, correlationId } = args;

  const verifyResult = await requestShopifyGraphQL<{ data: VerifyEvidenceResult }>({
    session: { shopDomain, accessToken },
    query: VERIFY_EVIDENCE_QUERY,
    variables: { id: disputeGid },
    correlationId,
  });

  // requestShopifyGraphQL returns { data: { node: { disputeEvidence } } }
  const rawResult = verifyResult as unknown as Record<string, unknown>;
  const dataNode = (rawResult.data as Record<string, unknown> | undefined)?.node as
    | Record<string, unknown>
    | undefined;
  const evidence = dataNode?.disputeEvidence as Record<string, unknown> | undefined;

  return {
    diff: diffVerificationReadback({
      inputKeys,
      evidenceFromShopify: evidence ?? null,
      inputValues,
    }),
    evidenceNode: evidence ?? null,
  };
}
