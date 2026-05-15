/**
 * One-shot: re-fetch the live state of one ShopifyPaymentsDisputeEvidence
 * directly from the Shopify Admin API for a given shop, and print what
 * is actually stored — bypassing our own verification cache.
 *
 * Usage: npx tsx scripts/inspect-shopify-evidence.ts
 *
 * Hardcoded for dispute bd425f70 / evidence GID 10548510777 — change
 * if you need to inspect another evidence row.
 */

import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const EVIDENCE_GID = "gid://shopify/ShopifyPaymentsDisputeEvidence/10548510777";

const QUERY = `
  query InspectDisputeEvidence($id: ID!) {
    node(id: $id) {
      __typename
      ... on ShopifyPaymentsDisputeEvidence {
        id
        accessActivityLog
        billingAddress { address1 city zip country }
        cancellationPolicyDisclosure
        cancellationPolicyFile { id }
        cancellationRebuttal
        customerEmailAddress
        customerCommunicationFile { id }
        customerFirstName
        customerLastName
        customerPurchaseIp
        productDescription
        refundPolicyDisclosure
        refundPolicyFile { id }
        refundRefusalExplanation
        serviceDocumentationFile { id }
        shippingAddress { address1 city zip country }
        shippingDocumentationFile { id }
        uncategorizedFile { id }
        uncategorizedText
      }
    }
  }
`;

interface EvidenceNode {
  __typename: string;
  id: string;
  accessActivityLog: string | null;
  billingAddress: unknown;
  cancellationPolicyDisclosure: string | null;
  cancellationPolicyFile: { id: string } | null;
  cancellationRebuttal: string | null;
  customerEmailAddress: string | null;
  customerCommunicationFile: { id: string } | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  customerPurchaseIp: string | null;
  productDescription: string | null;
  refundPolicyDisclosure: string | null;
  refundPolicyFile: { id: string } | null;
  refundRefusalExplanation: string | null;
  serviceDocumentationFile: { id: string } | null;
  shippingAddress: unknown;
  shippingDocumentationFile: { id: string } | null;
  uncategorizedFile: { id: string } | null;
  uncategorizedText: string | null;
}

async function main(): Promise<void> {
  const res = await makeAuthedRequest<{ node: EvidenceNode | null }>({
    shopId: SHOP_ID,
    query: QUERY,
    variables: { id: EVIDENCE_GID },
  });

  if (res.errors?.length) {
    console.error("GraphQL errors:");
    for (const e of res.errors) console.error("  -", e.message);
    process.exit(1);
  }

  const node = res.data?.node;
  if (!node) {
    console.error("node is null — Shopify did not return this evidence id");
    process.exit(2);
  }

  const filled: Record<string, unknown> = {};
  const empty: string[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (key === "__typename" || key === "id") continue;
    if (value == null || value === "") {
      empty.push(key);
    } else if (typeof value === "string") {
      filled[key] =
        value.length > 200 ? value.slice(0, 200) + "…" : value;
    } else {
      filled[key] = value;
    }
  }

  console.log("Evidence ID:", node.id);
  console.log("");
  console.log(`Filled fields (${Object.keys(filled).length}):`);
  for (const [k, v] of Object.entries(filled)) {
    console.log(`  ${k}:`, v);
  }
  console.log("");
  console.log(`Empty fields (${empty.length}):`);
  for (const k of empty) console.log(`  ${k}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
