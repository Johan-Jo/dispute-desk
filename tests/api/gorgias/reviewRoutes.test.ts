/**
 * Route tests for the Gorgias evidence-core review APIs (PR4).
 *
 * The heavy lifting (transactional state changes, ownership chain,
 * excerpt verbatim guard, bulk-exclude on reject, attention recompute)
 * lives in the `gorgias_review_message` / `gorgias_review_ticket` RPCs —
 * these tests pin the route contract: shop-context auth, input
 * validation, RPC parameter mapping, RPC-error → HTTP mapping, and the
 * cross-shop 404 posture (a foreign id is indistinguishable from a
 * missing one).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/integrations/gorgias/enqueueEnrichment", () => ({
  enqueueGorgiasEnrichment: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { enqueueGorgiasEnrichment } from "@/lib/integrations/gorgias/enqueueEnrichment";
import { POST as messageReview } from "@/app/api/disputes/[id]/gorgias/message-review/route";
import { POST as ticketReview } from "@/app/api/disputes/[id]/gorgias/ticket-review/route";
import { POST as enrich } from "@/app/api/disputes/[id]/gorgias/enrich/route";
import { GET as transcript } from "@/app/api/disputes/[id]/gorgias/tickets/[matchedTicketId]/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockEnqueue = vi.mocked(enqueueGorgiasEnrichment);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeRequest(shopId: string | null, body?: unknown): any {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (shopId) headers.set("x-shop-id", shopId);
  return {
    headers,
    nextUrl: { searchParams: new URLSearchParams() },
    json: async () => body ?? {},
    text: async () => JSON.stringify(body ?? {}),
  };
}

const routeParams = (id = "dispute-1") => ({ params: Promise.resolve({ id }) });
const transcriptParams = (id = "dispute-1", matchedTicketId = "mt-1") => ({
  params: Promise.resolve({ id, matchedTicketId }),
});

/** Chainable table builder with a fixed terminal result. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeBuilder(result: { data: unknown; error?: unknown }): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {};
  for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "limit", "update", "insert"]) {
    b[m] = vi.fn(() => b);
  }
  b.single = vi.fn(async () => ({ error: null, ...result }));
  b.maybeSingle = vi.fn(async () => ({ error: null, ...result }));
  b.then = (resolve: (v: unknown) => void) => resolve({ error: null, ...result });
  return b;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSb(tables: Record<string, any>, rpc = vi.fn()): any {
  return {
    rpc,
    from: vi.fn((table: string) => tables[table] ?? makeBuilder({ data: null })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/disputes/:id/gorgias/message-review", () => {
  it("401 without shop context", async () => {
    const res = await messageReview(makeRequest(null, {}), routeParams());
    expect(res.status).toBe(401);
  });

  it("400 on unknown action / missing messageId", async () => {
    mockGetServiceClient.mockReturnValue(makeSb({}));
    const noId = await messageReview(
      makeRequest("shop-1", { action: "approve" }),
      routeParams(),
    );
    expect(noId.status).toBe(400);
    const badAction = await messageReview(
      makeRequest("shop-1", { messageId: "m1", action: "obliterate" }),
      routeParams(),
    );
    expect(badAction.status).toBe(400);
  });

  it("calls the RPC with the full parameter set and returns the row", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "m1", review_status: "approved" }, error: null }));
    mockGetServiceClient.mockReturnValue(makeSb({}, rpc));

    const res = await messageReview(
      makeRequest("shop-1", {
        messageId: "m1",
        action: "approve",
        excerpt: "received order #1066",
      }),
      routeParams(),
    );

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("gorgias_review_message", {
      p_shop_id: "shop-1",
      p_dispute_id: "dispute-1",
      p_message_id: "m1",
      p_action: "approve",
      p_explanation: null,
      p_excerpt: "received order #1066",
      p_actor: "merchant",
    });
    const body = await res.json();
    expect(body.message.review_status).toBe("approved");
  });

  it("maps RPC errors: not_found → 404, not_confirmed → 409, excerpt → 400", async () => {
    const cases: Array<[string, number, string?]> = [
      ["message_not_found", 404],
      ["ticket_not_found", 404],
      ["ticket_not_confirmed", 409, "TICKET_NOT_CONFIRMED"],
      ["invalid_transition", 409, "INVALID_TRANSITION"],
      ["excerpt_not_verbatim", 400, "EXCERPT_NOT_VERBATIM"],
      ["explanation_required", 400, "EXPLANATION_REQUIRED"],
    ];
    for (const [rpcError, status, code] of cases) {
      const rpc = vi.fn(async () => ({ data: null, error: { message: rpcError } }));
      mockGetServiceClient.mockReturnValue(makeSb({}, rpc));
      const res = await messageReview(
        makeRequest("shop-1", { messageId: "m1", action: "exclude" }),
        routeParams(),
      );
      expect(res.status).toBe(status);
      if (code) {
        const body = await res.json();
        expect(body.code).toBe(code);
      }
    }
  });
});

describe("POST /api/disputes/:id/gorgias/ticket-review", () => {
  it("401 without shop context; 400 on bad action", async () => {
    expect((await ticketReview(makeRequest(null, {}), routeParams())).status).toBe(401);
    mockGetServiceClient.mockReturnValue(makeSb({}));
    const bad = await ticketReview(
      makeRequest("shop-1", { matchedTicketId: "mt-1", action: "vaporize" }),
      routeParams(),
    );
    expect(bad.status).toBe(400);
  });

  it("cross-shop ticket id → 404 (indistinguishable from absent)", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "ticket_not_found" } }));
    mockGetServiceClient.mockReturnValue(makeSb({}, rpc));
    const res = await ticketReview(
      makeRequest("shop-OTHER", { matchedTicketId: "mt-1", action: "reject" }),
      routeParams(),
    );
    expect(res.status).toBe(404);
  });

  it("confirm → RPC + analysis-only enrichment enqueue", async () => {
    const rpc = vi.fn(async () => ({
      data: { ticket: { id: "mt-1", match_status: "confirmed_match" }, messagesExcluded: 0 },
      error: null,
    }));
    mockGetServiceClient.mockReturnValue(makeSb({}, rpc));
    mockEnqueue.mockResolvedValue({ enqueued: true, runId: "run-2", jobId: "job-2" });

    const res = await ticketReview(
      makeRequest("shop-1", { matchedTicketId: "mt-1", action: "confirm" }),
      routeParams(),
    );
    expect(res.status).toBe(200);
    expect(mockEnqueue).toHaveBeenCalledWith({
      shopId: "shop-1",
      disputeId: "dispute-1",
      trigger: "ticket_confirmed",
    });
  });

  it("reject → RPC only, no enrichment enqueue", async () => {
    const rpc = vi.fn(async () => ({
      data: { ticket: { id: "mt-1", match_status: "rejected_match" }, messagesExcluded: 3 },
      error: null,
    }));
    mockGetServiceClient.mockReturnValue(makeSb({}, rpc));

    const res = await ticketReview(
      makeRequest("shop-1", { matchedTicketId: "mt-1", action: "reject" }),
      routeParams(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.messagesExcluded).toBe(3);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe("POST /api/disputes/:id/gorgias/enrich", () => {
  it("404 when the dispute belongs to another shop", async () => {
    mockGetServiceClient.mockReturnValue(
      makeSb({ disputes: makeBuilder({ data: null }) }),
    );
    const res = await enrich(makeRequest("shop-OTHER"), routeParams());
    expect(res.status).toBe(404);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("202 when enqueued", async () => {
    mockGetServiceClient.mockReturnValue(
      makeSb({ disputes: makeBuilder({ data: { id: "dispute-1" } }) }),
    );
    mockEnqueue.mockResolvedValue({ enqueued: true, runId: "run-9", jobId: "job-9" });
    const res = await enrich(makeRequest("shop-1"), routeParams());
    expect(res.status).toBe(202);
  });

  it("409 when Gorgias is not connected", async () => {
    mockGetServiceClient.mockReturnValue(
      makeSb({ disputes: makeBuilder({ data: { id: "dispute-1" } }) }),
    );
    mockEnqueue.mockResolvedValue({ enqueued: false, reason: "not_connected" });
    const res = await enrich(makeRequest("shop-1"), routeParams());
    expect(res.status).toBe(409);
  });

  it("200 + enqueued:false when a run is already active", async () => {
    mockGetServiceClient.mockReturnValue(
      makeSb({ disputes: makeBuilder({ data: { id: "dispute-1" } }) }),
    );
    mockEnqueue.mockResolvedValue({ enqueued: false, reason: "run_already_active" });
    const res = await enrich(makeRequest("shop-1"), routeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enqueued).toBe(false);
  });
});

describe("GET /api/disputes/:id/gorgias/tickets/:matchedTicketId", () => {
  it("cross-shop / unknown ticket → 404", async () => {
    mockGetServiceClient.mockReturnValue(
      makeSb({ gorgias_matched_tickets: makeBuilder({ data: null }) }),
    );
    const res = await transcript(makeRequest("shop-OTHER"), transcriptParams());
    expect(res.status).toBe(404);
  });

  it("returns transcript with needsReapproval computed from hash drift", async () => {
    mockGetServiceClient.mockReturnValue(
      makeSb({
        gorgias_matched_tickets: makeBuilder({
          data: {
            id: "mt-1",
            gorgias_ticket_id: 42,
            match_score: 150,
            confidence: "high",
            match_reasons: [],
            match_status: "confirmed_match",
            ticket_snapshot: { subject: "Order" },
            analyzed_at: null,
          },
        }),
        gorgias_evidence_messages: makeBuilder({
          data: [
            {
              id: "m-ok",
              gorgias_message_id: 1,
              sender_type: "customer",
              sender_name: "Anna",
              channel: "email",
              sent_at: "2026-03-10T10:00:00Z",
              message_text: "hello",
              content_truncated: false,
              original_character_count: 5,
              content_hash: "h1",
              evidence_category: "transaction_recognition",
              confidence_score: 90,
              relevance_explanation: "x",
              explanation_edited: false,
              review_status: "approved",
              approved_at: "2026-07-14T00:00:00Z",
              approved_by: "merchant",
              approved_excerpt: "hello",
              approved_content_hash: "h1",
            },
            {
              id: "m-drift",
              gorgias_message_id: 2,
              sender_type: "customer",
              sender_name: null,
              channel: "email",
              sent_at: null,
              message_text: "changed since approval",
              content_truncated: false,
              original_character_count: 22,
              content_hash: "h-NEW",
              evidence_category: null,
              confidence_score: null,
              relevance_explanation: null,
              explanation_edited: false,
              review_status: "approved",
              approved_at: "2026-07-14T00:00:00Z",
              approved_by: "merchant",
              approved_excerpt: "old text",
              approved_content_hash: "h-OLD",
            },
          ],
        }),
      }),
    );

    const res = await transcript(makeRequest("shop-1"), transcriptParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].needsReapproval).toBe(false);
    expect(body.messages[1].needsReapproval).toBe(true);
  });
});
