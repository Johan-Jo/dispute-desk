/**
 * Gorgias communication collector tests (post-cutover: merchant-review
 * only, DB-snapshot rendered — the Phase-1 auto-include path is gone).
 *
 * Safety pins:
 *   1. Only approved/manual, hash-intact messages on confirmed tickets
 *      render — pending / drifted / rejected content yields [].
 *   2. customerConfirmsOrder (the sole supporting→strong lever) fires
 *      only for customer-authored transaction_recognition on a non-low
 *      confirmed ticket; merchant-authored messages never count.
 *   3. Internal notes cannot appear here at all — they are filtered
 *      before persistence (pinned in the enrichment planner suite).
 */

import { describe, expect, it } from "vitest";
import {
  buildSnapshotSection,
  collectGorgiasCommEvidence,
  derivesCustomerConfirmsOrder,
  isIncludableMessage,
  type PersistedGorgiasEvidence,
  type PersistedGorgiasMessage,
  type PersistedGorgiasTicket,
} from "../gorgiasCommSource";
import type { BuildContext } from "../../types";
import { categorizeEvidenceField } from "@/lib/argument/canonicalEvidence";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

const ctx: BuildContext = {
  packId: "p1",
  disputeId: "d1",
  shopId: "s1",
  disputeReason: "fraudulent",
  orderGid: "gid://shopify/Order/1",
  shopDomain: "acme.myshopify.com",
  accessToken: "x",
  order: { email: "buyer@example.com" } as unknown as OrderDetailNode,
  paymentContext: { family: "card", raw: null, label: "Card", cardNetwork: null },
};

const noopLogEvent = async () => {};

function persistedMsg(
  over: Partial<PersistedGorgiasMessage> = {},
): PersistedGorgiasMessage {
  return {
    id: "gem-1",
    gorgiasMessageId: 9001,
    senderType: "customer",
    senderName: "Anna",
    channel: "email",
    sentAt: "2026-03-10T10:00:00Z",
    reviewStatus: "approved",
    evidenceCategory: "transaction_recognition",
    relevanceExplanation: "Customer acknowledges the disputed order.",
    approvedExcerpt: "I got order #1066 yesterday",
    approvedAt: "2026-07-14T00:00:00Z",
    approvedBy: "merchant",
    approvedContentHash: "h1",
    contentHash: "h1",
    contentTruncated: false,
    analyzerModel: "claude-haiku-4-5",
    analyzerPromptVersion: 1,
    ...over,
  };
}

function persistedTicket(
  over: Partial<PersistedGorgiasTicket> = {},
): PersistedGorgiasTicket {
  return {
    id: "mt-1",
    gorgiasTicketId: 42,
    confidence: "high",
    matchStatus: "confirmed_match",
    matchingAlgorithmVersion: 1,
    subject: "Where is my order #1066?",
    channel: "email",
    createdAt: "2026-03-10T09:00:00Z",
    csatScore: 5,
    messages: [persistedMsg()],
    ...over,
  };
}

function persisted(tickets: PersistedGorgiasTicket[]): PersistedGorgiasEvidence {
  return {
    tickets,
    matchSummary: { high: 1, medium: 0, low: 0, confirmed: 1, rejected: 0 },
  };
}

describe("collectGorgiasCommEvidence — guards", () => {
  it("returns [] when no enrichment rows exist for the dispute", async () => {
    const res = await collectGorgiasCommEvidence(ctx, {
      loadPersistedEvidence: async () => null,
      logEvent: noopLogEvent,
    });
    expect(res).toEqual([]);
  });

  it("returns [] while nothing is approved (enrichment pending / candidates only)", async () => {
    const res = await collectGorgiasCommEvidence(ctx, {
      loadPersistedEvidence: async () =>
        persisted([persistedTicket({ messages: [] })]),
      logEvent: noopLogEvent,
    });
    expect(res).toEqual([]);
  });

  it("never throws past the collector boundary", async () => {
    const res = await collectGorgiasCommEvidence(ctx, {
      loadPersistedEvidence: async () => {
        throw new Error("boom");
      },
      logEvent: noopLogEvent,
    });
    expect(res).toEqual([]);
  });
});

describe("collectGorgiasCommEvidence — approved snapshot", () => {
  it("renders the merchant-approved excerpt and approval metadata", async () => {
    const [section] = await collectGorgiasCommEvidence(ctx, {
      loadPersistedEvidence: async () => persisted([persistedTicket()]),
      logEvent: noopLogEvent,
    });
    expect(section.type).toBe("comms");
    expect(section.source).toBe("gorgias");
    expect(section.fieldsProvided).toEqual(["customer_communication"]);
    expect(section.labelToken).toEqual({
      key: "packs.section.customerCommunicationHistory",
    });
    expect(section.data.enriched).toBe(true);
    const conv = (section.data.conversations as Array<{ messages: unknown[] }>)[0];
    const m = conv.messages[0] as Record<string, unknown>;
    expect(m.excerpt).toBe("I got order #1066 yesterday");
    expect(m.approvedBy).toBe("merchant");
    expect(m.approvedContentHash).toBe("h1");
    expect(m.analyzerModel).toBe("claude-haiku-4-5");
  });

  it("emits the rendered-in-pack funnel event", async () => {
    const events: string[] = [];
    await collectGorgiasCommEvidence(ctx, {
      loadPersistedEvidence: async () => persisted([persistedTicket()]),
      logEvent: async (_shopId, name) => {
        events.push(name);
      },
    });
    expect(events).toEqual(["gorgias_evidence_rendered_in_pack"]);
  });
});

describe("inclusion guard", () => {
  it("hash drift, unconfirmed ticket, missing approval hash all exclude", () => {
    const t = persistedTicket();
    expect(isIncludableMessage(t, persistedMsg())).toBe(true);
    expect(isIncludableMessage(t, persistedMsg({ contentHash: "h-NEW" }))).toBe(
      false,
    ); // drifted since approval
    expect(
      isIncludableMessage(
        persistedTicket({ matchStatus: "proposed_match" }),
        persistedMsg(),
      ),
    ).toBe(false);
    expect(
      isIncludableMessage(t, persistedMsg({ approvedContentHash: null })),
    ).toBe(false);
  });

  it("rejected tickets contribute nothing even with formerly-approved messages", () => {
    const section = buildSnapshotSection(
      persisted([
        persistedTicket({
          matchStatus: "rejected_match",
          messages: [persistedMsg()],
        }),
      ]),
      { packId: "p1" },
    );
    expect(section).toBeNull();
  });
});

describe("customerConfirmsOrder derivation", () => {
  it("fires only for customer-authored transaction_recognition on a non-low confirmed ticket", () => {
    const t = persistedTicket();
    expect(derivesCustomerConfirmsOrder(t, persistedMsg())).toBe(true);
    // Merchant-authored "the customer confirmed" NEVER counts.
    expect(
      derivesCustomerConfirmsOrder(t, persistedMsg({ senderType: "merchant" })),
    ).toBe(false);
    // delivery_recognition renders but does not flip the flag.
    expect(
      derivesCustomerConfirmsOrder(
        t,
        persistedMsg({ evidenceCategory: "delivery_recognition" }),
      ),
    ).toBe(false);
    // Low-confidence tickets never qualify, even when confirmed.
    expect(
      derivesCustomerConfirmsOrder(
        persistedTicket({ confidence: "low" }),
        persistedMsg(),
      ),
    ).toBe(false);
    // Manual selections count — same validation chain.
    expect(
      derivesCustomerConfirmsOrder(t, persistedMsg({ reviewStatus: "manual" })),
    ).toBe(true);
  });

  it("upgrades to strong ONLY via the merchant-approved recognition path", () => {
    const strong = buildSnapshotSection(persisted([persistedTicket()]), {
      packId: "p1",
    })!;
    expect(strong.data.customerConfirmsOrder).toBe(true);
    expect(categorizeEvidenceField("customer_communication", strong.data)).toBe(
      "strong",
    );

    const supporting = buildSnapshotSection(
      persisted([
        persistedTicket({
          messages: [persistedMsg({ evidenceCategory: "refund_history" })],
        }),
      ]),
      { packId: "p1" },
    )!;
    expect(supporting.data.customerConfirmsOrder).toBeUndefined();
    expect(
      categorizeEvidenceField("customer_communication", supporting.data),
    ).toBe("supporting");
  });
});
