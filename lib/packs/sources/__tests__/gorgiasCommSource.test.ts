/**
 * Gorgias communication collector tests — injected deps (no Supabase /
 * no live API).
 *
 * Two safety pins carry the most weight here:
 *   1. An internal (public:false) note never reaches the emitted section
 *      (self-incrimination guard, legacy path).
 *   2. In merchant-review mode the collector renders ONLY approved,
 *      hash-intact messages from confirmed tickets — and never falls
 *      back to the legacy auto-include path.
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
import type {
  GorgiasClient,
  GorgiasCredentials,
  GorgiasMessage,
  GorgiasTicket,
} from "@/lib/integrations/gorgias/client";
import type { GorgiasConnection } from "@/lib/integrations/gorgias/credentials";
import { categorizeEvidenceField } from "@/lib/argument/canonicalEvidence";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

const creds: GorgiasCredentials = {
  subdomain: "acme",
  email: "ops@acme.com",
  apiKey: "k",
};

const legacyConn: GorgiasConnection = {
  integrationId: "int-1",
  credentials: creds,
  evidenceMode: "legacy_auto_include",
};

const reviewConn: GorgiasConnection = {
  integrationId: "int-1",
  credentials: creds,
  evidenceMode: "merchant_review_required",
};

const noopLogEvent = async () => {};

function ctxWithEmail(email: string | null): BuildContext {
  return {
    packId: "p1",
    disputeId: "d1",
    shopId: "s1",
    disputeReason: "fraudulent",
    orderGid: "gid://shopify/Order/1",
    shopDomain: "acme.myshopify.com",
    accessToken: "x",
    order: { email } as unknown as OrderDetailNode,
    paymentContext: { family: "card", raw: null, label: "Card", cardNetwork: null },
  };
}

function msg(over: Partial<GorgiasMessage>): GorgiasMessage {
  return {
    id: 1,
    public: true,
    channel: "email",
    from_agent: false,
    stripped_text: "hello",
    body_text: null,
    body_html: null,
    sent_datetime: "2026-06-01T10:00:00Z",
    created_datetime: "2026-06-01T10:00:00Z",
    ...over,
  };
}

function ticket(over: Partial<GorgiasTicket>): GorgiasTicket {
  return {
    id: 100,
    status: "closed",
    channel: "email",
    spam: false,
    trashed_datetime: null,
    created_datetime: "2026-06-01T09:00:00Z",
    updated_datetime: "2026-06-01T11:00:00Z",
    messages: [],
    satisfaction_survey: null,
    ...over,
  };
}

function fakeClient(tickets: GorgiasTicket[]): GorgiasClient {
  return {
    resolveCustomerByEmail: async () => ({ id: 42, email: "buyer@example.com" }),
    listCustomerTickets: async () => tickets,
    listTicketMessages: async () => [],
  };
}

const deps = (tickets: GorgiasTicket[]) => ({
  loadConnection: async () => legacyConn,
  loadCredentials: async () => creds,
  createClient: () => fakeClient(tickets),
  logEvent: noopLogEvent,
});

describe("gorgiasCommSource — guards", () => {
  it("returns [] when the order has no email", async () => {
    const res = await collectGorgiasCommEvidence(ctxWithEmail(null), deps([]));
    expect(res).toEqual([]);
  });

  it("returns [] when no Gorgias integration is connected", async () => {
    const res = await collectGorgiasCommEvidence(ctxWithEmail("buyer@example.com"), {
      loadConnection: async () => null,
    });
    expect(res).toEqual([]);
  });

  it("returns [] when the email matches no Gorgias customer", async () => {
    const res = await collectGorgiasCommEvidence(ctxWithEmail("buyer@example.com"), {
      loadConnection: async () => legacyConn,
      loadCredentials: async () => creds,
      createClient: () => ({
        resolveCustomerByEmail: async () => null,
        listCustomerTickets: async () => [],
        listTicketMessages: async () => [],
      }),
      logEvent: noopLogEvent,
    });
    expect(res).toEqual([]);
  });

  it("never throws past the collector boundary (returns [] on client error)", async () => {
    const res = await collectGorgiasCommEvidence(ctxWithEmail("buyer@example.com"), {
      loadConnection: async () => legacyConn,
      loadCredentials: async () => creds,
      createClient: () => ({
        resolveCustomerByEmail: async () => {
          throw new Error("boom");
        },
        listCustomerTickets: async () => [],
        listTicketMessages: async () => [],
      }),
      logEvent: noopLogEvent,
    });
    expect(res).toEqual([]);
  });
});

describe("gorgiasCommSource — self-incrimination guard", () => {
  it("drops internal (public:false) notes and internal-note channel", async () => {
    const tickets = [
      ticket({
        messages: [
          msg({ id: 1, public: true, stripped_text: "Thanks, I got my order!" }),
          msg({
            id: 2,
            public: false,
            stripped_text: "This buyer looks sketchy — just refund.",
          }),
          msg({
            id: 3,
            public: true,
            channel: "internal-note",
            stripped_text: "internal channel leak",
          }),
        ],
      }),
    ];
    const [section] = await collectGorgiasCommEvidence(
      ctxWithEmail("buyer@example.com"),
      deps(tickets),
    );
    expect(section).toBeTruthy();
    const allText = JSON.stringify(section.data);
    expect(allText).toContain("Thanks, I got my order!");
    expect(allText).not.toContain("sketchy");
    expect(allText).not.toContain("internal channel leak");
  });

  it("excludes trashed and spam tickets", async () => {
    const tickets = [
      ticket({ id: 1, trashed_datetime: "2026-06-02T00:00:00Z", messages: [msg({})] }),
      ticket({ id: 2, spam: true, messages: [msg({})] }),
    ];
    const res = await collectGorgiasCommEvidence(
      ctxWithEmail("buyer@example.com"),
      deps(tickets),
    );
    expect(res).toEqual([]);
  });
});

describe("gorgiasCommSource — emitted section", () => {
  it("emits customer_communication that classifies as supporting by default", async () => {
    const tickets = [ticket({ messages: [msg({ stripped_text: "hi there" })] })];
    const [section] = await collectGorgiasCommEvidence(
      ctxWithEmail("buyer@example.com"),
      deps(tickets),
    );
    expect(section.type).toBe("comms");
    expect(section.source).toBe("gorgias");
    expect(section.fieldsProvided).toEqual(["customer_communication"]);
    expect(section.labelToken).toEqual({ key: "packs.section.gorgiasCommunication" });
    // Phase 1 never sets customerConfirmsOrder → stays supporting.
    expect(section.data.customerConfirmsOrder).toBeUndefined();
    expect(categorizeEvidenceField("customer_communication", section.data)).toBe(
      "supporting",
    );
  });

  it("falls back to a per-ticket messages call when not embedded", async () => {
    const client: GorgiasClient = {
      resolveCustomerByEmail: async () => ({ id: 42, email: "buyer@example.com" }),
      listCustomerTickets: async () => [ticket({ messages: null })],
      listTicketMessages: async () => [msg({ stripped_text: "fetched separately" })],
    };
    const [section] = await collectGorgiasCommEvidence(ctxWithEmail("buyer@example.com"), {
      loadConnection: async () => legacyConn,
      loadCredentials: async () => creds,
      createClient: () => client,
      logEvent: noopLogEvent,
    });
    expect(JSON.stringify(section.data)).toContain("fetched separately");
  });
});

// ── Merchant-review mode ─────────────────────────────────────────────────────

function persistedMsg(over: Partial<PersistedGorgiasMessage> = {}): PersistedGorgiasMessage {
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

function persistedTicket(over: Partial<PersistedGorgiasTicket> = {}): PersistedGorgiasTicket {
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

describe("gorgiasCommSource — merchant-review mode", () => {
  it("renders ONLY approved messages from the DB snapshot — no API call", async () => {
    let apiTouched = false;
    const [section] = await collectGorgiasCommEvidence(ctxWithEmail("buyer@example.com"), {
      loadConnection: async () => reviewConn,
      loadPersistedEvidence: async () => persisted([persistedTicket()]),
      // Legacy seams present but must never be touched in review mode.
      loadCredentials: async () => {
        apiTouched = true;
        return creds;
      },
      createClient: () => {
        apiTouched = true;
        return fakeClient([]);
      },
      logEvent: noopLogEvent,
    });
    expect(apiTouched).toBe(false);
    expect(section.labelToken).toEqual({
      key: "packs.section.customerCommunicationHistory",
    });
    expect(section.data.enriched).toBe(true);
    const conv = (section.data.conversations as Array<{ messages: unknown[] }>)[0];
    expect(conv.messages).toHaveLength(1);
    const m = conv.messages[0] as Record<string, unknown>;
    expect(m.excerpt).toBe("I got order #1066 yesterday");
    expect(m.approvedBy).toBe("merchant");
    expect(m.approvedContentHash).toBe("h1");
  });

  it("returns [] while nothing is approved (enrichment pending) — NEVER legacy fallback", async () => {
    let legacyTouched = false;
    const res = await collectGorgiasCommEvidence(ctxWithEmail("buyer@example.com"), {
      loadConnection: async () => reviewConn,
      loadPersistedEvidence: async () =>
        persisted([persistedTicket({ messages: [persistedMsg({ reviewStatus: "approved", approvedContentHash: null })] })]),
      loadCredentials: async () => {
        legacyTouched = true;
        return creds;
      },
      logEvent: noopLogEvent,
    });
    expect(res).toEqual([]);
    expect(legacyTouched).toBe(false);

    const noRows = await collectGorgiasCommEvidence(ctxWithEmail("buyer@example.com"), {
      loadConnection: async () => reviewConn,
      loadPersistedEvidence: async () => null,
      loadCredentials: async () => {
        legacyTouched = true;
        return creds;
      },
      logEvent: noopLogEvent,
    });
    expect(noRows).toEqual([]);
    expect(legacyTouched).toBe(false);
  });

  it("inclusion guard: hash drift, unconfirmed ticket, non-approved status all exclude", () => {
    const t = persistedTicket();
    expect(isIncludableMessage(t, persistedMsg())).toBe(true);
    expect(
      isIncludableMessage(t, persistedMsg({ contentHash: "h-NEW" })),
    ).toBe(false); // drifted since approval
    expect(
      isIncludableMessage(persistedTicket({ matchStatus: "proposed_match" }), persistedMsg()),
    ).toBe(false);
    expect(
      isIncludableMessage(t, persistedMsg({ reviewStatus: "approved", approvedContentHash: null })),
    ).toBe(false);
  });

  it("customerConfirmsOrder: customer-authored transaction_recognition on a non-low ticket only", () => {
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

  it("snapshot upgrades to strong ONLY via the merchant-approved recognition path", () => {
    const strong = buildSnapshotSection(persisted([persistedTicket()]), { packId: "p1" })!;
    expect(strong.data.customerConfirmsOrder).toBe(true);
    expect(categorizeEvidenceField("customer_communication", strong.data)).toBe("strong");

    const supporting = buildSnapshotSection(
      persisted([
        persistedTicket({
          messages: [persistedMsg({ evidenceCategory: "refund_history" })],
        }),
      ]),
      { packId: "p1" },
    )!;
    expect(supporting.data.customerConfirmsOrder).toBeUndefined();
    expect(categorizeEvidenceField("customer_communication", supporting.data)).toBe(
      "supporting",
    );
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
