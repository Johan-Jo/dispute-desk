/**
 * The merchant's own file in Shopify's uncategorized evidence slot
 * (bank-claim plan F4).
 *
 * Our save writes exactly one file, into `uncategorizedFile`
 * (`composeShopifyMutationPayload`). On a reopened dispute that slot can hold
 * the merchant's round-one upload — measured 2026-09-28: 6 of 8 open reopened
 * disputes ("AdditionalEvidence.pdf"). Writing ours there replaces theirs, and
 * we never do that without the merchant's approval.
 *
 * Ours are always named `Defence-<disputeId>-…pdf` (saveToShopifyJob), so any
 * other name is the merchant's (or something they put there through Shopify).
 */

import { requestShopifyGraphQL } from "./graphql";

export interface EvidenceSlotFile {
  originalFileName: string | null;
  fileType: string | null;
  url: string | null;
}

const UNCATEGORIZED_FILE_QUERY = `query DisputeUncategorizedFile($id: ID!) {
  node(id: $id) {
    ... on ShopifyPaymentsDisputeEvidence {
      uncategorizedFile { originalFileName fileType url }
    }
  }
}`;

/** Our PDF's filename shape, set in saveToShopifyJob. */
export function isDisputeDeskFile(originalFileName: string | null | undefined): boolean {
  return typeof originalFileName === "string" && /^Defence-\d+-/.test(originalFileName);
}

export type UncategorizedSlotRead =
  | { ok: true; file: EvidenceSlotFile | null }
  | { ok: false; error: string };

/**
 * Read what the uncategorized slot holds now. `ok: false` means we could not
 * tell — the caller must NOT write over an unknown (fail closed).
 */
export async function readUncategorizedFile(args: {
  shopDomain: string;
  accessToken: string;
  disputeEvidenceGid: string;
  correlationId?: string;
}): Promise<UncategorizedSlotRead> {
  try {
    const res = await requestShopifyGraphQL<{
      node?: { uncategorizedFile?: EvidenceSlotFile | null } | null;
    }>({
      session: { shopDomain: args.shopDomain, accessToken: args.accessToken },
      query: UNCATEGORIZED_FILE_QUERY,
      variables: { id: args.disputeEvidenceGid },
      correlationId: args.correlationId,
    });
    if (res.errors && res.errors.length > 0) {
      return { ok: false, error: JSON.stringify(res.errors).slice(0, 300) };
    }
    return { ok: true, file: res.data?.node?.uncategorizedFile ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
