import { describe, it, expect } from "vitest";
import { collectCustomerCommEvidence } from "../customerCommSource";
import type { BuildContext } from "../../types";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

/**
 * Regression tests for the customer-communication collector.
 *
 * The load-bearing invariant: `customer_communication` is emitted ONLY when
 * there is real human authorship (staff note, customer note, or a merchant
 * timeline comment). App-injected buyer attributes (Rebuy / Smart Cart / UTM)
 * and pure system timeline events must NEVER emit it — that false positive
 * made the merchant email claim "We've already attached: Customer support
 * conversations" on orders with zero real conversations.
 */

type EventNode = {
  id: string;
  message: string;
  createdAt: string;
  attributeToUser: boolean;
};

function makeOrder(opts: {
  note?: string | null;
  customerNote?: string | null;
  customAttributes?: Array<{ key: string; value: string | null }>;
  events?: EventNode[];
}): OrderDetailNode {
  return {
    note: opts.note ?? null,
    customer: opts.customerNote ? { note: opts.customerNote } : { note: null },
    customAttributes: opts.customAttributes ?? [],
    events: {
      edges: (opts.events ?? []).map((node) => ({ node })),
    },
  } as unknown as OrderDetailNode;
}

function makeCtx(order: OrderDetailNode | null): BuildContext {
  return {
    packId: "pack-1",
    disputeId: "dispute-1",
    shopId: "shop-1",
    disputeReason: "FRAUDULENT",
    orderGid: "gid://shopify/Order/1",
    shopDomain: "blume-box.myshopify.com",
    accessToken: "tok",
    order,
    paymentContext: { family: "card" },
  } as unknown as BuildContext;
}

const evt = (message: string, attributeToUser = false): EventNode => ({
  id: `gid://shopify/BasicEvent/${message.length}`,
  message,
  createdAt: "2026-07-02T03:46:31Z",
  attributeToUser,
});

describe("collectCustomerCommEvidence", () => {
  it("does NOT emit customer_communication for app-injected buyer attributes only (the blume-box bug)", () => {
    // Rebuy / Smart Cart attributes + pure system timeline — zero real comms.
    const order = makeOrder({
      customAttributes: [
        { key: "_attribution", value: "Smart Cart 2.0" },
        { key: "_source", value: "Rebuy" },
        { key: "_barId", value: "33792-33357-abc" },
      ],
      events: [
        evt("Sharon Whitlock placed this order on Online Store."),
        evt("Confirmation #0PXC3T0KA was generated for this order."),
        evt("Order confirmation email was sent to the customer."),
      ],
    });

    return collectCustomerCommEvidence(makeCtx(order)).then((sections) => {
      expect(sections).toHaveLength(0);
    });
  });

  it("emits customer_communication for a real staff note", async () => {
    const sections = await collectCustomerCommEvidence(
      makeCtx(makeOrder({ note: "Called customer, confirmed they received it." })),
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].fieldsProvided).toContain("customer_communication");
    expect(sections[0].source).toBe("shopify_timeline");
  });

  it("emits customer_communication for a real customer note", async () => {
    const sections = await collectCustomerCommEvidence(
      makeCtx(makeOrder({ customerNote: "Great customer, repeat buyer." })),
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].fieldsProvided).toContain("customer_communication");
  });

  it("emits customer_communication for a merchant timeline comment", async () => {
    const sections = await collectCustomerCommEvidence(
      makeCtx(makeOrder({ events: [evt("Reached out to buyer re: address", true)] })),
    );
    expect(sections).toHaveLength(1);
  });

  it("does NOT emit for a genuine buyer note alone (not two-way support engagement)", async () => {
    // A plain-key buyer note survives the app-attribute filter but is not, on
    // its own, counted as real support engagement.
    const sections = await collectCustomerCommEvidence(
      makeCtx(makeOrder({ customAttributes: [{ key: "delivery_instructions", value: "Leave at door" }] })),
    );
    expect(sections).toHaveLength(0);
  });

  it("does NOT emit for pure system timeline events", async () => {
    const sections = await collectCustomerCommEvidence(
      makeCtx(
        makeOrder({
          events: [
            evt("$120.00 USD was authorized using a Mastercard."),
            evt("A capture is pending."),
          ],
        }),
      ),
    );
    expect(sections).toHaveLength(0);
  });

  it("strips app-injected attributes from the section data when emitted for a real reason", async () => {
    const sections = await collectCustomerCommEvidence(
      makeCtx(
        makeOrder({
          note: "Spoke with customer.",
          customAttributes: [
            { key: "_source", value: "Rebuy" },
            { key: "gift_message", value: "Happy birthday!" },
          ],
        }),
      ),
    );
    expect(sections).toHaveLength(1);
    const attrs = (sections[0].data as { buyerAttributes: Array<{ key: string }> })
      .buyerAttributes;
    const keys = attrs.map((a) => a.key);
    expect(keys).toContain("gift_message");
    expect(keys).not.toContain("_source");
  });
});
