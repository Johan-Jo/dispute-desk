/**
 * Pure-planner tests for the Gorgias enrichment module.
 *
 * These pin the idempotency contract: source refresh never clobbers
 * merchant decisions, approved-source drift forces re-review, internal
 * notes never reach a DB write, truncation keeps the hash over the full
 * original text.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_CHARS,
  customerIdDigits,
  hashContent,
  initialMatchStatus,
  isPublicMessage,
  planMessagePersistence,
  planTicketPersistence,
  snapshotMessage,
  scoreTicket,
  ticketSnapshotJson,
  type ExistingMessageRow,
  type ExistingTicketRow,
  type MessageSnapshot,
} from "../enrichment";
import type { GorgiasMessage, GorgiasTicket } from "../client";
import type { OrderMatchSignals } from "../matchScoring";

function msg(overrides: Partial<GorgiasMessage> = {}): GorgiasMessage {
  return {
    id: 9001,
    public: true,
    channel: "email",
    from_agent: false,
    stripped_text: "I received order #1066 yesterday, thanks!",
    body_text: null,
    body_html: null,
    sent_datetime: "2026-03-10T10:00:00Z",
    created_datetime: "2026-03-10T10:00:00Z",
    source: { from: { name: "Anna" } },
    ...overrides,
  };
}

function ticket(overrides: Partial<GorgiasTicket> = {}): GorgiasTicket {
  return {
    id: 42,
    status: "closed",
    channel: "email",
    spam: false,
    subject: "Where is my order?",
    trashed_datetime: null,
    created_datetime: "2026-03-10T09:00:00Z",
    updated_datetime: "2026-03-11T09:00:00Z",
    satisfaction_survey: { score: 5 },
    ...overrides,
  };
}

const order: OrderMatchSignals = {
  orderName: "#1066",
  customerEmail: "anna@example.com",
  shopifyCustomerId: null,
  trackingNumbers: [],
  orderCreatedAt: "2026-03-01T10:00:00Z",
  deliveredAt: "2026-03-06T10:00:00Z",
  chargebackAt: "2026-06-20T10:00:00Z",
};

const ids = { shopId: "s1", disputeId: "d1", integrationId: "i1" };
const msgIds = { shopId: "s1", disputeId: "d1", matchedTicketId: "mt1" };

describe("snapshotMessage", () => {
  it("drops internal notes and non-public messages", () => {
    expect(isPublicMessage(msg({ public: false }))).toBe(false);
    expect(snapshotMessage(msg({ public: false }))).toBeNull();
    expect(snapshotMessage(msg({ channel: "internal-note" }))).toBeNull();
  });

  it("drops empty-text messages", () => {
    expect(snapshotMessage(msg({ stripped_text: "  ", body_text: null }))).toBeNull();
  });

  it("maps sender type and name", () => {
    const customer = snapshotMessage(msg())!;
    expect(customer.senderType).toBe("customer");
    expect(customer.senderName).toBe("Anna");
    const merchant = snapshotMessage(msg({ from_agent: true }))!;
    expect(merchant.senderType).toBe("merchant");
  });

  it("truncates display text at the bound but hashes the FULL text", () => {
    const long = "x".repeat(MAX_MESSAGE_CHARS + 500);
    const snap = snapshotMessage(msg({ stripped_text: long }))!;
    expect(snap.text).toHaveLength(MAX_MESSAGE_CHARS);
    expect(snap.contentTruncated).toBe(true);
    expect(snap.originalCharacterCount).toBe(MAX_MESSAGE_CHARS + 500);
    expect(snap.contentHash).toBe(hashContent(long));
    expect(snap.contentHash).not.toBe(hashContent(snap.text));
  });
});

describe("scoreTicket + ticketSnapshotJson", () => {
  it("scores from subject + public message text", () => {
    const snaps = [snapshotMessage(msg())!];
    const scored = scoreTicket(
      ticket({ customer: { id: 7, email: "anna@example.com" } }),
      snaps,
      order,
    );
    // email +50, order number +80, window +20
    expect(scored.result.score).toBe(150);
    expect(scored.result.confidence).toBe("high");
  });

  it("freezes subject/status/channel/csat", () => {
    expect(ticketSnapshotJson(ticket())).toEqual({
      subject: "Where is my order?",
      status: "closed",
      channel: "email",
      createdAt: "2026-03-10T09:00:00Z",
      csatScore: 5,
    });
  });
});

describe("planTicketPersistence", () => {
  const scoredHigh = scoreTicket(
    ticket({ customer: { id: 7, email: "anna@example.com" } }),
    [snapshotMessage(msg())!],
    order,
  );
  const scoredMedium = scoreTicket(
    ticket({ customer: { id: 7, email: "anna@example.com" } }),
    [],
    order,
  ); // email +50 + window +20 = 70

  it("inserts high tier as confirmed_match (auto-matched)", () => {
    const plan = planTicketPersistence(null, scoredHigh, ids);
    expect(plan.action).toBe("insert");
    if (plan.action === "insert") {
      expect(plan.row.match_status).toBe("confirmed_match");
      expect(plan.row.confidence).toBe("high");
      expect(plan.row.matching_algorithm_version).toBe(1);
    }
  });

  it("inserts medium tier as proposed_match", () => {
    expect(initialMatchStatus("medium")).toBe("proposed_match");
    const plan = planTicketPersistence(null, scoredMedium, ids);
    if (plan.action === "insert") {
      expect(plan.row.match_status).toBe("proposed_match");
    }
  });

  it("refreshes only proposed_match rows", () => {
    const pending: ExistingTicketRow = {
      id: "row1",
      gorgias_ticket_id: 42,
      match_status: "proposed_match",
    };
    const plan = planTicketPersistence(pending, scoredHigh, ids);
    expect(plan.action).toBe("update");
  });

  it("never touches confirmed or rejected tickets", () => {
    for (const status of ["confirmed_match", "rejected_match"] as const) {
      const existing: ExistingTicketRow = {
        id: "row1",
        gorgias_ticket_id: 42,
        match_status: status,
      };
      expect(planTicketPersistence(existing, scoredHigh, ids).action).toBe("skip");
    }
  });
});

describe("planMessagePersistence", () => {
  const incoming: MessageSnapshot = snapshotMessage(msg())!;

  function existing(over: Partial<ExistingMessageRow> = {}): ExistingMessageRow {
    return {
      id: "m-row-1",
      gorgias_message_id: 9001,
      review_status: "candidate",
      content_hash: incoming.contentHash,
      approved_content_hash: null,
      ...over,
    };
  }

  it("inserts new messages as candidate", () => {
    const plan = planMessagePersistence(null, incoming, msgIds);
    expect(plan.action).toBe("insert");
    if (plan.action === "insert") {
      expect(plan.row.review_status).toBe("candidate");
      expect(plan.row.content_hash).toBe(incoming.contentHash);
    }
  });

  it("skips unchanged rows", () => {
    expect(planMessagePersistence(existing(), incoming, msgIds).action).toBe("skip");
  });

  it("refreshes source fields without touching review/approval columns", () => {
    const plan = planMessagePersistence(
      existing({ content_hash: "old-hash", review_status: "proposed" }),
      incoming,
      msgIds,
    );
    expect(plan.action).toBe("update");
    if (plan.action === "update") {
      const keys = Object.keys(plan.patch);
      expect(keys).not.toContain("review_status");
      expect(keys).not.toContain("approved_at");
      expect(keys).not.toContain("approved_by");
      expect(keys).not.toContain("approved_excerpt");
      expect(keys).not.toContain("approved_content_hash");
      expect(keys).not.toContain("relevance_explanation");
    }
  });

  it("approved message + matching approval hash → skip (approval stays valid)", () => {
    const plan = planMessagePersistence(
      existing({
        review_status: "approved",
        approved_content_hash: incoming.contentHash,
      }),
      incoming,
      msgIds,
    );
    expect(plan.action).toBe("skip");
  });

  it("approved message whose source drifted → re-proposed, approval metadata retained", () => {
    const plan = planMessagePersistence(
      existing({
        review_status: "approved",
        content_hash: "old-hash",
        approved_content_hash: "old-hash",
      }),
      incoming,
      msgIds,
    );
    expect(plan.action).toBe("drift_reproposal");
    if (plan.action === "drift_reproposal") {
      expect(plan.patch.review_status).toBe("proposed");
      // approval columns intentionally NOT cleared — audit history.
      expect(Object.keys(plan.patch)).not.toContain("approved_at");
      expect(Object.keys(plan.patch)).not.toContain("approved_content_hash");
    }
  });

  it("manual message drift is treated like approved drift", () => {
    const plan = planMessagePersistence(
      existing({
        review_status: "manual",
        content_hash: "old-hash",
        approved_content_hash: "old-hash",
      }),
      incoming,
      msgIds,
    );
    expect(plan.action).toBe("drift_reproposal");
  });
});

describe("customerIdDigits", () => {
  it("extracts digits from a Customer GID or passes digits through", () => {
    expect(customerIdDigits("gid://shopify/Customer/555001")).toBe("555001");
    expect(customerIdDigits("555001")).toBe("555001");
    expect(customerIdDigits(null)).toBeNull();
    expect(customerIdDigits("gid://shopify/Customer/")).toBeNull();
  });
});
