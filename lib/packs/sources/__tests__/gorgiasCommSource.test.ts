/**
 * Gorgias communication collector tests — injected deps (no Supabase /
 * no live API).
 *
 * Highest-value assertion: an internal (public:false) note never reaches
 * the emitted section — it would be a self-incriminating confession.
 */

import { describe, expect, it } from "vitest";
import { collectGorgiasCommEvidence } from "../gorgiasCommSource";
import type { BuildContext } from "../../types";
import type {
  GorgiasClient,
  GorgiasCredentials,
  GorgiasMessage,
  GorgiasTicket,
} from "@/lib/integrations/gorgias/client";
import { categorizeEvidenceField } from "@/lib/argument/canonicalEvidence";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

const creds: GorgiasCredentials = {
  subdomain: "acme",
  email: "ops@acme.com",
  apiKey: "k",
};

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
  loadCredentials: async () => creds,
  createClient: () => fakeClient(tickets),
});

describe("gorgiasCommSource — guards", () => {
  it("returns [] when the order has no email", async () => {
    const res = await collectGorgiasCommEvidence(ctxWithEmail(null), deps([]));
    expect(res).toEqual([]);
  });

  it("returns [] when no Gorgias integration is connected", async () => {
    const res = await collectGorgiasCommEvidence(ctxWithEmail("buyer@example.com"), {
      loadCredentials: async () => null,
    });
    expect(res).toEqual([]);
  });

  it("returns [] when the email matches no Gorgias customer", async () => {
    const res = await collectGorgiasCommEvidence(ctxWithEmail("buyer@example.com"), {
      loadCredentials: async () => creds,
      createClient: () => ({
        resolveCustomerByEmail: async () => null,
        listCustomerTickets: async () => [],
        listTicketMessages: async () => [],
      }),
    });
    expect(res).toEqual([]);
  });

  it("never throws past the collector boundary (returns [] on client error)", async () => {
    const res = await collectGorgiasCommEvidence(ctxWithEmail("buyer@example.com"), {
      loadCredentials: async () => creds,
      createClient: () => ({
        resolveCustomerByEmail: async () => {
          throw new Error("boom");
        },
        listCustomerTickets: async () => [],
        listTicketMessages: async () => [],
      }),
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
      loadCredentials: async () => creds,
      createClient: () => client,
    });
    expect(JSON.stringify(section.data)).toContain("fetched separately");
  });
});
