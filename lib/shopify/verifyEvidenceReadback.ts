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
 * NOTE: shippingDocumentation is WRITE-ONLY via the mutation.
 * The readable equivalent is shippingDocumentationFile (file upload).
 * Text fields we can verify: accessActivityLog, cancellationRebuttal,
 * cancellationPolicyDisclosure, refundPolicyDisclosure, uncategorizedText.
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
        }
      }
    }
  }
`;

/** Fields that are readable via the Shopify API for verification. */
export const VERIFIABLE_FIELDS: ReadonlySet<string> = new Set([
  "accessActivityLog",
  "cancellationPolicyDisclosure",
  "cancellationRebuttal",
  "customerEmailAddress",
  "refundPolicyDisclosure",
  "refundRefusalExplanation",
  "uncategorizedText",
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
  const { inputKeys, evidenceFromShopify } = args;
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
  const { shopDomain, accessToken, disputeGid, inputKeys, correlationId } = args;

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
    }),
    evidenceNode: evidence ?? null,
  };
}
