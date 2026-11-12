/**
 * Live read of an order's REFUND state: what money has been refunded, is on its way, or failed.
 *
 * WHY THIS EXISTS. The evidence pack stores `Order.totalRefundedSet` and the refund entries' amounts, and
 * nothing else. Measured live (2026-11-12, docs/plans/pending-refund-advice.plan.md): from the moment a
 * merchant clicks "refund" until the payment provider settles it (about 24 h on the SEK shops, Klarna and
 * card alike) Shopify reports `Order.totalRefundedSet` = 0.0 AND `Refund.totalRefundedSet` = 0.0, and the
 * order stays PAID. The money is visible ONLY on `Refund.transactions` (kind REFUND, status PENDING). A
 * `Refund` with no transactions at all is a record with no money (order edit, cancellation).
 *
 * This query asks for exactly that and nothing else, so it stays cheap enough to run from a cron over every
 * open inquiry. It needs no scope beyond `read_orders` / `read_all_orders`. It deliberately does NOT read
 * `Order.returns` (that needs `read_returns`, which the app does not hold); `returnStatus` is enough.
 *
 * The interpretation lives in ONE place: `lib/disputes/refundState.ts`.
 */

import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";

/** Caps. The resolver treats a read that reached any cap as INCOMPLETE (unknown), never as "none". */
export const REFUND_STATE_REFUNDS_CAP = 10;
export const REFUND_STATE_REFUND_TX_CAP = 10;
export const REFUND_STATE_ORDER_TX_CAP = 30;

const MONEY = `shopMoney { amount currencyCode }`;

export const ORDER_REFUND_STATE_QUERY = /* GraphQL */ `
  query OrderRefundState($id: ID!) {
    order(id: $id) {
      id
      displayFinancialStatus
      returnStatus
      paymentGatewayNames
      totalRefundedSet { ${MONEY} }
      refunds(first: ${REFUND_STATE_REFUNDS_CAP}) {
        id
        createdAt
        updatedAt
        totalRefundedSet { ${MONEY} }
        transactions(first: ${REFUND_STATE_REFUND_TX_CAP}) {
          pageInfo { hasNextPage }
          nodes {
            id
            kind
            status
            processedAt
            amountSet { ${MONEY} }
          }
        }
      }
      transactions(first: ${REFUND_STATE_ORDER_TX_CAP}) {
        id
        kind
        status
        amountSet { ${MONEY} }
      }
    }
  }
`;

export interface RawMoney {
  shopMoney?: { amount?: string | number | null; currencyCode?: string | null } | null;
}

export interface RawRefundTransaction {
  id?: string | null;
  kind?: string | null;
  status?: string | null;
  processedAt?: string | null;
  amountSet?: RawMoney | null;
}

export interface RawRefundEntry {
  id?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  totalRefundedSet?: RawMoney | null;
  transactions?: { pageInfo?: { hasNextPage?: boolean | null } | null; nodes?: RawRefundTransaction[] | null } | null;
}

export interface RawOrderRefundState {
  id: string;
  displayFinancialStatus?: string | null;
  returnStatus?: string | null;
  paymentGatewayNames?: string[] | null;
  totalRefundedSet?: RawMoney | null;
  refunds?: RawRefundEntry[] | null;
  transactions?: Array<{
    id?: string | null;
    kind?: string | null;
    status?: string | null;
    amountSet?: RawMoney | null;
  }> | null;
}

interface OrderRefundStateResponse {
  order: RawOrderRefundState | null;
}

/**
 * Read one order's refund state. Throws on a transport / GraphQL error (the caller must treat a throw as
 * "unknown", never as "no refund"). Returns null when Shopify has no such order.
 */
export async function fetchOrderRefundState(opts: {
  shopId: string;
  orderGid: string;
  correlationId?: string;
}): Promise<RawOrderRefundState | null> {
  const resp = await makeAuthedRequest<OrderRefundStateResponse>({
    shopId: opts.shopId,
    query: ORDER_REFUND_STATE_QUERY,
    variables: { id: opts.orderGid },
    correlationId: opts.correlationId ?? "order-refund-state",
    locale: "en",
  });
  if (resp.errors && resp.errors.length > 0) {
    throw new Error(
      `Shopify refund-state read failed for ${opts.orderGid}: ${resp.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return resp.data?.order ?? null;
}
