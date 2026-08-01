/**
 * manualSource collector tests.
 *
 * Pins the bug fix for dispute D466 (2026-05-22): when a merchant
 * submits a cardholder-acknowledgement, the resulting evidence_items
 * row carries `payload.customerConfirmsOrder: true`. The section
 * emitted by manualSource must surface that discriminator at the top
 * level of `section.data` so the factClassifier's customer_communication
 * extractor (lib/defence/factClassifier.ts:266) finds it and elevates
 * the fact to strength="strong", includeInBankNarrative=true.
 *
 * Without this surfacing the LLM omits the communicationArgument
 * entirely and the cardholder confirmation never reaches the bank.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { collectManualEvidence } from "../manualSource";
import type { BuildContext } from "../../types";

const mockGetClient = vi.mocked(getServiceClient);

function buildSb(rows: unknown[] | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    })),
  };
}

const CTX: BuildContext = {
  packId: "p1",
  disputeId: "d1",
  shopId: "shop1",
  disputeReason: "FRAUDULENT",
  orderGid: "gid://shopify/Order/1001",
  shopDomain: "demo.myshopify.com",
  accessToken: "tok",
  order: null,
  paymentContext: { family: "card", raw: null, label: "Card", cardNetwork: null },
  priorHistory: null,
  disputeInitiatedAt: null,
  disputeAmount: null,
  disputeCurrency: null,
  disputePhase: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("collectManualEvidence — cardholder acknowledgement surfacing", () => {
  it("returns [] when no manual uploads exist", async () => {
    mockGetClient.mockReturnValue(buildSb([]) as never);
    expect(await collectManualEvidence(CTX)).toEqual([]);
  });

  it("flattens customerConfirmsOrder=true to section.data when an upload carries it", async () => {
    const rows = [
      {
        id: "ev1",
        type: "comms",
        label: "Cardholder acknowledgement",
        payload: {
          kind: "cardholder_acknowledgement",
          text: "Yes I placed and received this order.",
          textLength: 42,
          customerConfirmsOrder: true,
          confirmedByMerchant: true,
          confirmedAt: "2026-05-22T14:18:00.000Z",
          confirmedBy: "merchant",
          checklistField: "customer_communication",
          fieldsProvided: ["customer_communication"],
        },
        created_at: "2026-05-22T14:18:00.000Z",
      },
    ];
    mockGetClient.mockReturnValue(buildSb(rows) as never);

    const sections = await collectManualEvidence(CTX);
    expect(sections).toHaveLength(1);
    const data = sections[0].data as Record<string, unknown>;
    expect(data.customerConfirmsOrder).toBe(true);
    expect(data.messageCount).toBe(1);
    expect(data.lastMessageAt).toBe("2026-05-22T14:18:00.000Z");
    // Existing nested uploads array stays intact so downstream consumers
    // that walk the upload list (PDF attachment renderer, audit trail)
    // keep working.
    expect(Array.isArray(data.uploads)).toBe(true);
    expect((data.uploads as unknown[]).length).toBe(1);
  });

  it("leaves customerConfirmsOrder=false when no upload carries the flag", async () => {
    const rows = [
      {
        id: "ev2",
        type: "other",
        label: "Supporting document",
        payload: { kind: null, note: "screenshot" },
        created_at: "2026-05-22T10:00:00.000Z",
      },
    ];
    mockGetClient.mockReturnValue(buildSb(rows) as never);

    const sections = await collectManualEvidence(CTX);
    const data = sections[0].data as Record<string, unknown>;
    expect(data.customerConfirmsOrder).toBe(false);
  });

  it("picks the most recent confirmedAt across multiple acknowledgements", async () => {
    const rows = [
      {
        id: "ev_old",
        type: "comms",
        label: "Cardholder acknowledgement (first attempt)",
        payload: {
          kind: "cardholder_acknowledgement",
          customerConfirmsOrder: true,
          confirmedAt: "2026-05-20T08:00:00.000Z",
        },
        created_at: "2026-05-20T08:00:00.000Z",
      },
      {
        id: "ev_new",
        type: "comms",
        label: "Cardholder acknowledgement (final)",
        payload: {
          kind: "cardholder_acknowledgement",
          customerConfirmsOrder: true,
          confirmedAt: "2026-05-22T14:18:00.000Z",
        },
        created_at: "2026-05-22T14:18:00.000Z",
      },
    ];
    mockGetClient.mockReturnValue(buildSb(rows) as never);

    const sections = await collectManualEvidence(CTX);
    const data = sections[0].data as Record<string, unknown>;
    expect(data.customerConfirmsOrder).toBe(true);
    expect(data.messageCount).toBe(2);
    expect(data.lastMessageAt).toBe("2026-05-22T14:18:00.000Z");
  });
});
