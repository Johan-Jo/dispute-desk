/**
 * One-shot PROD read: does Shopify hold ANY fulfillment events /
 * deliveredAt for cay-collective order #12809 (dispute #891BECCC)?
 *
 * The DHL Freight SE tracking page shows terminal "Picked up by
 * receiver" (2026-06-04, DIREKTEN LÖDÖSE Servicepoint) but our
 * shopify_orders row has tracking_source=null. This distinguishes:
 *   (a) Shopify HAS events → our ingest/backfill gap (fix on our side)
 *   (b) Shopify has NOTHING → DHL Freight doesn't feed Shopify; needs
 *       an external source (tracking app or DHL API).
 *
 * Usage: npx tsx scripts/inspect-dhl-order-12809.ts
 * Reads .env.production.local (PROD) — read-only GraphQL query.
 */

import { config } from "dotenv";
import { join } from "node:path";
config({ path: join(process.cwd(), ".env.production.local") });
config({ path: join(process.cwd(), ".env.local") });
config({ path: join(process.cwd(), ".env") });

import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";

const SHOP_ID = "c497df8d-632d-49da-b385-eb523f57f341"; // cay-collective (prod)
// Default: #12809 (the DHL Freight dispute order). Pass another order GID
// as argv[2] to compare (e.g. the PostNord order #12936 that DID sync).
const ORDER_GID = process.argv[2] ?? "gid://shopify/Order/8199481196810"; // #12809

// events newest-first — sortKey HAPPENED_AT + reverse. Oldest-first with a
// small page truncated BEFORE the delivery event in the 2026-07-06 PostNord
// investigation and misread the order as Returned. Do not change.
const QUERY = `
  query InspectOrderDelivery($id: ID!) {
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
          updatedAt
          deliveredAt
          estimatedDeliveryAt
          inTransitAt
          trackingInfo(first: 10) {
            number
            url
            company
          }
          events(first: 30, sortKey: HAPPENED_AT, reverse: true) {
            edges {
              node {
                happenedAt
                status
                message
              }
            }
          }
        }
      }
    }
  }
`;

interface EventNode {
  happenedAt: string;
  status: string | null;
  message: string | null;
}
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
    updatedAt: string;
    deliveredAt: string | null;
    estimatedDeliveryAt: string | null;
    inTransitAt: string | null;
    trackingInfo: Array<{ number: string | null; url: string | null; company: string | null }>;
    events: { edges: Array<{ node: EventNode }> };
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

  console.log("Order:", node.name, node.id);
  console.log("displayFulfillmentStatus:", node.displayFulfillmentStatus);
  console.log("Fulfillments:", node.fulfillments.length);
  for (const f of node.fulfillments) {
    console.log("");
    console.log(`  ${f.id}`);
    console.log(`    status/displayStatus: ${f.status} / ${f.displayStatus ?? "(none)"}`);
    console.log(`    createdAt: ${f.createdAt}  updatedAt: ${f.updatedAt}`);
    console.log(`    deliveredAt: ${f.deliveredAt ?? "(null)"}  inTransitAt: ${f.inTransitAt ?? "(null)"}  eta: ${f.estimatedDeliveryAt ?? "(null)"}`);
    for (const t of f.trackingInfo) {
      console.log(`    tracking: company=${t.company ?? "?"} number=${t.number ?? "?"}`);
    console.log(`              url=${t.url ?? "(none)"}`);
    }
    const events = f.events.edges;
    console.log(`    events (${events.length}, newest first):`);
    for (const { node: ev } of events) {
      console.log(`      ${ev.happenedAt}  [${ev.status ?? "?"}]  ${ev.message ?? ""}`);
    }
    if (events.length === 0) console.log("      (NONE — Shopify has no carrier events for this fulfillment)");
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
