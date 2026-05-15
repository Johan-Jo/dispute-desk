/**
 * One-shot: re-fetch the Shopify order's fulfillment status + tracking
 * info directly, to confirm whether the absence of shipping evidence
 * in a pack reflects reality (order unfulfilled) or a collector bug
 * (we missed a real fulfillment).
 *
 * Usage: npx tsx scripts/inspect-shopify-order-fulfillment.ts
 *
 * Hardcoded for the surasvenne shop + order 6433300545593 from the
 * 2026-05-15 incident; change as needed.
 */

import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";

const SHOP_ID = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const ORDER_GID = "gid://shopify/Order/6433300545593";

const QUERY = `
  query InspectOrderFulfillment($id: ID!) {
    node(id: $id) {
      __typename
      ... on Order {
        id
        name
        displayFulfillmentStatus
        fulfillments(first: 10) {
          id
          status
          displayStatus
          createdAt
          deliveredAt
          estimatedDeliveryAt
          trackingInfo(first: 10) {
            number
            url
            company
          }
          fulfillmentLineItems(first: 50) {
            edges {
              node {
                lineItem { title }
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

interface OrderNode {
  __typename: string;
  id: string;
  name: string;
  displayFulfillmentStatus: string;
  fulfillments: Array<{
    id: string;
    status: string;
    displayStatus: string | null;
    createdAt: string;
    deliveredAt: string | null;
    estimatedDeliveryAt: string | null;
    trackingInfo: Array<{
      number: string | null;
      url: string | null;
      company: string | null;
    }>;
    fulfillmentLineItems: {
      edges: Array<{ node: { lineItem: { title: string }; quantity: number } }>;
    };
  }>;
}

async function main(): Promise<void> {
  const res = await makeAuthedRequest<{ node: OrderNode | null }>({
    shopId: SHOP_ID,
    query: QUERY,
    variables: { id: ORDER_GID },
  });

  if (res.errors?.length) {
    console.error("GraphQL errors:");
    for (const e of res.errors) console.error("  -", e.message);
    process.exit(1);
  }

  const node = res.data?.node;
  if (!node) {
    console.error("order is null");
    process.exit(2);
  }

  console.log("Order:", node.name, "(", node.id, ")");
  console.log("displayFulfillmentStatus:", node.displayFulfillmentStatus);
  console.log("Fulfillments:", node.fulfillments.length);

  for (const f of node.fulfillments) {
    console.log("");
    console.log(`  ${f.id}`);
    console.log(`    status: ${f.status}`);
    console.log(`    displayStatus: ${f.displayStatus ?? "(none)"}`);
    console.log(`    createdAt: ${f.createdAt}`);
    console.log(`    deliveredAt: ${f.deliveredAt ?? "(not delivered)"}`);
    console.log(`    estimatedDeliveryAt: ${f.estimatedDeliveryAt ?? "(none)"}`);
    console.log(`    tracking: ${f.trackingInfo.length} entries`);
    for (const t of f.trackingInfo) {
      console.log(`      - ${t.company ?? "?"} #${t.number ?? "?"} ${t.url ?? ""}`);
    }
    console.log(`    line items:`);
    for (const li of f.fulfillmentLineItems.edges) {
      console.log(`      - ${li.node.quantity}× ${li.node.lineItem.title}`);
    }
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
