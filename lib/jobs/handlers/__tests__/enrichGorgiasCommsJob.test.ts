/**
 * Tests for `handleEnrichGorgiasComms`.
 *
 * Pins the failure-classification contract (not-connected → non-retriable;
 * Gorgias 401 → reconnect_required + failed_terminal, no retry loop) and
 * the happy-path persistence + run-completion flow. Fine-grained upsert
 * semantics live in the pure-planner suite
 * (lib/integrations/gorgias/__tests__/enrichment.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/setup/events", () => ({
  logSetupEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email/sendGorgiasEvidenceReadyAlert", () => ({
  sendGorgiasEvidenceReadyAlert: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logSetupEvent } from "@/lib/setup/events";
import { sendGorgiasEvidenceReadyAlert } from "@/lib/email/sendGorgiasEvidenceReadyAlert";
import { handleEnrichGorgiasComms } from "../enrichGorgiasCommsJob";
import type { ClaimedJob } from "../../claimJobs";
import type { GorgiasClient, GorgiasTicket } from "@/lib/integrations/gorgias/client";
import type { GorgiasConnection } from "@/lib/integrations/gorgias/credentials";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogEvent = vi.mocked(logSetupEvent);
const mockSendEvidenceReadyAlert = vi.mocked(sendGorgiasEvidenceReadyAlert);

function makeJob(entityId: string | null = "dispute-1"): ClaimedJob {
  return {
    id: "job-1",
    shopId: "shop-1",
    jobType: "enrich_gorgias_comms",
    entityId: entityId as string,
    attempts: 0,
    maxAttempts: 3,
    priority: 100,
  };
}

const CONN: GorgiasConnection = {
  integrationId: "int-1",
  credentials: { subdomain: "acme", email: "ops@acme.com", apiKey: "k" },
  evidenceMode: "merchant_review_required",
};

/**
 * Scriptable Supabase fake: per-table FIFO queues of results. Every chain
 * method is a passthrough; awaiting the chain (or .single/.maybeSingle)
 * pops the next scripted result for that table. All calls are recorded.
 */
type ScriptResult = { data?: unknown; error?: unknown; count?: number | null };

function makeSb(script: Record<string, ScriptResult[]>) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const queues = new Map<string, ScriptResult[]>(
    Object.entries(script).map(([k, v]) => [k, [...v]]),
  );

  function from(table: string) {
    const next = (): ScriptResult => {
      const q = queues.get(table);
      return q && q.length > 0 ? q.shift()! : { data: null, error: null };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    for (const m of ["select", "eq", "neq", "in", "is", "order", "limit", "update", "insert", "upsert"]) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, op: m, args });
        return chain;
      };
    }
    chain.maybeSingle = async () => next();
    chain.single = async () => next();
    chain.then = (
      resolve: (v: ScriptResult) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(next()).then(resolve, reject);
    return chain;
  }

  return { sb: { from } as never, calls };
}

function fakeClient(overrides: Partial<GorgiasClient> = {}): GorgiasClient {
  return {
    resolveCustomerByEmail: vi.fn(async () => ({ id: 7, email: "anna@example.com" })),
    listCustomerTickets: vi.fn(async () => [] as GorgiasTicket[]),
    listTicketMessages: vi.fn(async () => []),
    ...overrides,
  };
}

const ACTIVE_RUN = {
  id: "run-1",
  status: "queued",
  attempt_count: 0,
  started_at: new Date().toISOString(),
};

const DISPUTE_ROW = {
  id: "dispute-1",
  customer_email: "anna@example.com",
  order_name: "#1066",
  order_gid: "gid://shopify/Order/1",
  initiated_at: "2026-06-20T10:00:00Z",
};

const ORDER_ROW = {
  customer_email: "anna@example.com",
  customer_shopify_id: "gid://shopify/Customer/555001",
  shopify_order_number: "#1066",
  created_at_shopify: "2026-03-01T10:00:00Z",
  fulfilled_at: "2026-03-03T10:00:00Z",
  delivered_at_tracking: "2026-03-06T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleEnrichGorgiasComms — short circuits", () => {
  it("missing entity_id → non-retriable failure", async () => {
    const res = await handleEnrichGorgiasComms(makeJob(null));
    expect(res).toEqual({
      ok: false,
      reason: "entity_id (dispute id) missing",
      retriable: false,
    });
  });

  it("not connected → non-retriable + cancels queued runs", async () => {
    const { sb, calls } = makeSb({});
    mockGetServiceClient.mockReturnValue(sb);
    const res = await handleEnrichGorgiasComms(makeJob(), {
      loadConnection: async () => null,
    });
    expect(res).toEqual({ ok: false, reason: "gorgias_not_connected", retriable: false });
    const cancel = calls.find(
      (c) => c.table === "gorgias_enrichment_runs" && c.op === "update",
    );
    expect(cancel).toBeTruthy();
    expect((cancel!.args[0] as Record<string, unknown>).status).toBe("cancelled");
  });
});

describe("handleEnrichGorgiasComms — auth revocation", () => {
  it("Gorgias 401 → needs_attention + failed_terminal + no retry", async () => {
    const { sb, calls } = makeSb({
      gorgias_enrichment_runs: [
        { data: ACTIVE_RUN }, // acquireRun: active lookup
        { data: null }, // attempt_count update
        { data: [{ id: "run-1" }] }, // transition queued → resolving_customer
        { data: null }, // finishRun update
      ],
      disputes: [{ data: DISPUTE_ROW }],
      shopify_orders: [{ data: ORDER_ROW }],
      integrations: [
        { data: { meta: { subdomain: "acme" } } }, // markReconnectRequired read
        { data: null }, // markReconnectRequired update
      ],
    });
    mockGetServiceClient.mockReturnValue(sb);

    const res = await handleEnrichGorgiasComms(makeJob(), {
      loadConnection: async () => CONN,
      createClient: () =>
        fakeClient({
          resolveCustomerByEmail: vi.fn(async () => {
            throw new Error("Gorgias API 401 on /api/customers");
          }),
        }),
    });

    expect(res).toEqual({ ok: false, reason: "gorgias_auth_revoked", retriable: false });

    const integrationUpdate = calls.find(
      (c) => c.table === "integrations" && c.op === "update",
    );
    expect(integrationUpdate).toBeTruthy();
    const patch = integrationUpdate!.args[0] as Record<string, unknown>;
    expect(patch.status).toBe("needs_attention");
    expect((patch.meta as Record<string, unknown>).error_code).toBe("reconnect_required");

    const runUpdates = calls.filter(
      (c) => c.table === "gorgias_enrichment_runs" && c.op === "update",
    );
    const terminal = runUpdates.find(
      (c) => (c.args[0] as Record<string, unknown>).status === "failed_terminal",
    );
    expect(terminal).toBeTruthy();
    expect((terminal!.args[0] as Record<string, unknown>).error_code).toBe(
      "reconnect_required",
    );
  });
});

describe("handleEnrichGorgiasComms — outcomes", () => {
  it("no Gorgias customer → run finishes no_matches, job succeeds", async () => {
    const { sb, calls } = makeSb({
      gorgias_enrichment_runs: [
        { data: ACTIVE_RUN },
        { data: null },
        { data: [{ id: "run-1" }] },
        { data: null }, // finishRun
      ],
      disputes: [{ data: DISPUTE_ROW }],
      shopify_orders: [{ data: ORDER_ROW }],
    });
    mockGetServiceClient.mockReturnValue(sb);

    const res = await handleEnrichGorgiasComms(makeJob(), {
      loadConnection: async () => CONN,
      createClient: () =>
        fakeClient({ resolveCustomerByEmail: vi.fn(async () => null) }),
    });

    expect(res).toEqual({ ok: true });
    const finish = calls
      .filter((c) => c.table === "gorgias_enrichment_runs" && c.op === "update")
      .find((c) => (c.args[0] as Record<string, unknown>).status === "no_matches");
    expect(finish).toBeTruthy();
    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "gorgias_enrichment_no_matches",
      expect.objectContaining({ reason: "customer_not_found" }),
    );
    // No proposals → no evidence-ready email.
    expect(mockSendEvidenceReadyAlert).not.toHaveBeenCalled();
  });

  it("happy path: scores, persists, analyzes, proposes, finishes ready_for_review", async () => {
    const gorgiasTicket: GorgiasTicket = {
      id: 42,
      status: "closed",
      channel: "email",
      spam: false,
      subject: "Where is my order #1066?",
      customer: { id: 7, email: "anna@example.com" },
      trashed_datetime: null,
      created_datetime: "2026-03-10T09:00:00Z",
      updated_datetime: null,
      messages: [
        {
          id: 9001,
          public: true,
          channel: "email",
          from_agent: false,
          stripped_text: "I got order #1066 yesterday, looks great",
          body_text: null,
          body_html: null,
          sent_datetime: "2026-03-10T10:00:00Z",
          created_datetime: null,
        },
        {
          id: 9002,
          public: false, // internal note — must never be persisted
          channel: "internal-note",
          from_agent: true,
          stripped_text: "just refund this sketchy customer",
          body_text: null,
          body_html: null,
          sent_datetime: null,
          created_datetime: null,
        },
      ],
    };

    const { sb, calls } = makeSb({
      gorgias_enrichment_runs: [
        { data: ACTIVE_RUN },
        { data: null }, // attempt_count update
        { data: [{ id: "run-1" }] }, // → resolving_customer
        { data: [{ id: "run-1" }] }, // → searching_tickets
        { data: [{ id: "run-1" }] }, // → fetching_messages
        { data: [{ id: "run-1" }] }, // → analyzing
        { data: null }, // finishRun (ready_for_review)
        { data: null, count: 0 }, // first-enriched count
      ],
      disputes: [
        { data: DISPUTE_ROW }, // loadOrderSignals
        { data: { reason: "fraudulent", network_reason_code: "10.4", order_name: "#1066" } }, // analysis
        { data: null }, // attention update
        { data: { reason: "fraudulent", amount: "110.89", currency_code: "USD" } }, // evidence-ready email meta
      ],
      shopify_orders: [{ data: ORDER_ROW }],
      shops: [{ data: { locale: "en" } }],
      gorgias_matched_tickets: [
        { data: [] }, // existing rows
        { data: { id: "mt-1" } }, // insert → select single
        {
          data: [
            {
              id: "mt-1",
              gorgias_ticket_id: 42,
              ticket_snapshot: { subject: "Where is my order #1066?", channel: "email" },
            },
          ],
        }, // analyzable tickets
        { data: null }, // analyzed_at stamp
      ],
      gorgias_evidence_messages: [
        { data: [] }, // existing messages
        { data: null }, // insert
        {
          data: [
            {
              id: "gem-1",
              matched_ticket_id: "mt-1",
              sender_type: "customer",
              sent_at: "2026-03-10T10:00:00Z",
              message_text: "I got order #1066 yesterday, looks great",
              content_truncated: false,
            },
          ],
        }, // candidates
        { data: [{ id: "gem-1" }] }, // proposal update → select
      ],
    });
    mockGetServiceClient.mockReturnValue(sb);

    const analyze = vi.fn(async () => ({
      proposals: [
        {
          id: "gem-1",
          category: "transaction_recognition" as const,
          explanation: "The customer acknowledges the disputed order.",
          confidence: 90,
        },
      ],
      rejectedCount: 0,
      overflowCount: 0,
      model: "claude-haiku-4-5",
      promptVersion: 1,
      tokens: { prompt: 800, completion: 60, cached: 0 },
      durationMs: 400,
      capReached: false,
      error: null,
    }));

    const res = await handleEnrichGorgiasComms(makeJob(), {
      loadConnection: async () => CONN,
      createClient: () =>
        fakeClient({
          listCustomerTickets: vi.fn(async () => [gorgiasTicket]),
        }),
      analyze,
    });

    expect(res).toEqual({ ok: true });
    expect(analyze).toHaveBeenCalledTimes(1);

    const ticketInsert = calls.find(
      (c) => c.table === "gorgias_matched_tickets" && c.op === "insert",
    );
    expect(ticketInsert).toBeTruthy();
    const row = ticketInsert!.args[0] as Record<string, unknown>;
    expect(row.confidence).toBe("high"); // email +50, order# +80, window +20
    expect(row.match_status).toBe("confirmed_match");

    const msgInserts = calls.filter(
      (c) => c.table === "gorgias_evidence_messages" && c.op === "insert",
    );
    expect(msgInserts).toHaveLength(1); // internal note dropped
    const msgRow = msgInserts[0].args[0] as Record<string, unknown>;
    expect(msgRow.gorgias_message_id).toBe(9001);
    expect(msgRow.review_status).toBe("candidate");
    expect(String(msgRow.message_text)).not.toContain("sketchy");

    // Proposal write is guarded candidate → proposed only.
    const proposalUpdate = calls
      .filter((c) => c.table === "gorgias_evidence_messages" && c.op === "update")
      .find(
        (c) => (c.args[0] as Record<string, unknown>).review_status === "proposed",
      );
    expect(proposalUpdate).toBeTruthy();
    const proposalPatch = proposalUpdate!.args[0] as Record<string, unknown>;
    expect(proposalPatch.evidence_category).toBe("transaction_recognition");
    expect(proposalPatch.analyzer_model).toBe("claude-haiku-4-5");
    const guardEq = calls.filter(
      (c) =>
        c.table === "gorgias_evidence_messages" &&
        c.op === "eq" &&
        c.args[0] === "review_status" &&
        c.args[1] === "candidate",
    );
    expect(guardEq.length).toBeGreaterThan(0);

    const finish = calls
      .filter((c) => c.table === "gorgias_enrichment_runs" && c.op === "update")
      .find(
        (c) => (c.args[0] as Record<string, unknown>).status === "ready_for_review",
      );
    expect(finish).toBeTruthy();
    const finishPatch = finish!.args[0] as Record<string, unknown>;
    expect(finishPatch.tickets_high).toBe(1);
    expect(finishPatch.messages_stored).toBe(1);
    expect(finishPatch.proposal_count).toBe(1);

    // Ready-for-review raises dispute attention.
    const attention = calls
      .filter((c) => c.table === "disputes" && c.op === "update")
      .find(
        (c) =>
          (c.args[0] as Record<string, unknown>).attention_reason ===
          "gorgias_evidence_ready",
      );
    expect(attention).toBeTruthy();
    expect((attention!.args[0] as Record<string, unknown>).needs_attention).toBe(true);

    // Ready-for-review ALSO fires the evidence-ready email (not just the
    // in-app flag) — the whole point of the notification gap fix.
    expect(mockSendEvidenceReadyAlert).toHaveBeenCalledTimes(1);
    expect(mockSendEvidenceReadyAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: "shop-1",
        disputeId: "dispute-1",
        proposalCount: 1,
        reason: "fraudulent",
        amount: 110.89,
        currencyCode: "USD",
      }),
    );

    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "gorgias_enrichment_started",
      expect.objectContaining({ runId: "run-1" }),
    );
    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "gorgias_ticket_matched",
      expect.objectContaining({ confidence: "high" }),
    );
    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "gorgias_enrichment_completed",
      expect.objectContaining({ messagesStored: 1, proposalCount: 1 }),
    );
    expect(mockLogEvent).toHaveBeenCalledWith(
      "shop-1",
      "gorgias_first_dispute_enriched",
      expect.objectContaining({ runId: "run-1" }),
    );
  });

  it("LLM cap reached → analysis_deferred with next_retry_at, never no_matches", async () => {
    const gorgiasTicket: GorgiasTicket = {
      id: 42,
      status: "closed",
      channel: "email",
      spam: false,
      subject: "Where is my order #1066?",
      customer: { id: 7, email: "anna@example.com" },
      trashed_datetime: null,
      created_datetime: "2026-03-10T09:00:00Z",
      updated_datetime: null,
      messages: [
        {
          id: 9001,
          public: true,
          channel: "email",
          from_agent: false,
          stripped_text: "I got order #1066 yesterday",
          body_text: null,
          body_html: null,
          sent_datetime: "2026-03-10T10:00:00Z",
          created_datetime: null,
        },
      ],
    };

    const { sb, calls } = makeSb({
      gorgias_enrichment_runs: [
        { data: ACTIVE_RUN },
        { data: null },
        { data: [{ id: "run-1" }] },
        { data: [{ id: "run-1" }] },
        { data: [{ id: "run-1" }] },
        { data: [{ id: "run-1" }] }, // → analyzing
        { data: null }, // finishRun (analysis_deferred)
        { data: null, count: 0 },
      ],
      disputes: [
        { data: DISPUTE_ROW },
        { data: { reason: "fraudulent", network_reason_code: null, order_name: "#1066" } },
      ],
      shopify_orders: [{ data: ORDER_ROW }],
      shops: [{ data: { locale: "en" } }],
      gorgias_matched_tickets: [
        { data: [] },
        { data: { id: "mt-1" } },
        {
          data: [
            { id: "mt-1", gorgias_ticket_id: 42, ticket_snapshot: {} },
          ],
        },
      ],
      gorgias_evidence_messages: [
        { data: [] },
        { data: null },
        {
          data: [
            {
              id: "gem-1",
              matched_ticket_id: "mt-1",
              sender_type: "customer",
              sent_at: null,
              message_text: "I got order #1066 yesterday",
              content_truncated: false,
            },
          ],
        },
      ],
    });
    mockGetServiceClient.mockReturnValue(sb);

    const res = await handleEnrichGorgiasComms(makeJob(), {
      loadConnection: async () => CONN,
      createClient: () =>
        fakeClient({ listCustomerTickets: vi.fn(async () => [gorgiasTicket]) }),
      analyze: vi.fn(async () => ({
        proposals: [],
        rejectedCount: 0,
        overflowCount: 0,
        model: "claude-haiku-4-5",
        promptVersion: 1,
        tokens: { prompt: 0, completion: 0, cached: 0 },
        durationMs: 0,
        capReached: true,
        error: null,
      })),
    });

    expect(res).toEqual({ ok: true });
    const finish = calls
      .filter((c) => c.table === "gorgias_enrichment_runs" && c.op === "update")
      .find(
        (c) =>
          (c.args[0] as Record<string, unknown>).status === "analysis_deferred",
      );
    expect(finish).toBeTruthy();
    const patch = finish!.args[0] as Record<string, unknown>;
    expect(patch.error_code).toBe("llm_cap_reached");
    expect(patch.next_retry_at).toBeTruthy();
    // Ticket rows were persisted — matches remain visible while deferred.
    expect(
      calls.some((c) => c.table === "gorgias_matched_tickets" && c.op === "insert"),
    ).toBe(true);
  });

  it("transient failure → failed_retryable + rethrow for worker backoff", async () => {
    const { sb, calls } = makeSb({
      gorgias_enrichment_runs: [
        { data: ACTIVE_RUN },
        { data: null },
        { data: [{ id: "run-1" }] },
        { data: null }, // failed_retryable update
      ],
      disputes: [{ data: DISPUTE_ROW }],
      shopify_orders: [{ data: ORDER_ROW }],
    });
    mockGetServiceClient.mockReturnValue(sb);

    await expect(
      handleEnrichGorgiasComms(makeJob(), {
        loadConnection: async () => CONN,
        createClient: () =>
          fakeClient({
            resolveCustomerByEmail: vi.fn(async () => {
              throw new Error("Gorgias API 502 on /api/customers");
            }),
          }),
      }),
    ).rejects.toThrow(/502/);

    const retryable = calls
      .filter((c) => c.table === "gorgias_enrichment_runs" && c.op === "update")
      .find(
        (c) => (c.args[0] as Record<string, unknown>).status === "failed_retryable",
      );
    expect(retryable).toBeTruthy();
  });
});
