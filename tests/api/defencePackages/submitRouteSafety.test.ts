/**
 * PR-C1 — the embedded Review & Submit endpoint refuses an unsafe candidate
 * BEFORE enqueueing.
 *
 * This is the route `CompleteDefencePackageCard.onSubmit()` calls. Before the
 * fix it enqueued unconditionally and returned `{ ok: true }`, the card set
 * `submitPending` and called `markJustSubmitted()`, and the worker blocked the
 * Shopify mutation minutes later — leaving the merchant looking at a submitted
 * state for a package that was never going to be filed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({ extractShopId: () => "shop-1" }));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { POST } from "@/app/api/defence-packages/[id]/submit/route";
import { NextRequest } from "next/server";

const mockClient = vi.mocked(getServiceClient);
const mockAudit = vi.mocked(logAuditEvent);

const PKG_ID = "pkg-3";
const DISPUTE_ID = "dispute-1";

const CLEAN_NARRATIVE = {
  fulfillmentArgument: {
    text: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1234567890).",
  },
};
const UNSAFE_NARRATIVE = {
  fulfillmentArgument: {
    text: "The parcel was delivered to the cardholder's verified address on 12 May 2026.",
  },
};
const CLEAN_FACTS = [
  { id: "f1", category: "delivery_proof", value: { proofType: "delivered_confirmed" } },
];
const RETIRED_FACTS = [
  { id: "f1", category: "delivery_proof", value: { deliveredToVerifiedAddress: true } },
];

function mockSupabase(args: {
  named: Record<string, unknown> | null;
  /** The newest version for the dispute — drives the currency check. */
  latestId?: string;
}) {
  const jobsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  let call = 0;
  const from = vi.fn((table: string) => {
    if (table === "defence_packages") {
      // Call 1: the named row (single). Call 2: the named row again via
      // preflight (maybeSingle). Call 3: the latest-version probe.
      const q: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: args.named, error: null }),
        maybeSingle: vi.fn().mockImplementation(async () => {
          call += 1;
          // The currency probe is the one that orders by version.
          return call >= 2
            ? { data: { id: args.latestId ?? PKG_ID, version: 3 }, error: null }
            : { data: args.named, error: null };
        }),
      };
      return q;
    }
    if (table === "jobs") return { insert: jobsInsert };
    throw new Error(`unexpected table: ${table}`);
  });
  mockClient.mockReturnValue({ from } as never);
  return { jobsInsert };
}

const req = () => new NextRequest("https://x.test/api/defence-packages/pkg-3/submit", { method: "POST" });
const params = { params: Promise.resolve({ id: PKG_ID }) };

const pkg = (over: Record<string, unknown>) => ({
  id: PKG_ID,
  status: "final",
  source_pack_id: "pack-1",
  shop_id: "shop-1",
  dispute_id: DISPUTE_ID,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("POST /api/defence-packages/:id/submit — PR-C1 preflight", () => {
  it("returns 422 PACKAGE_REVIEW_REQUIRED and enqueues NOTHING for an unsafe narrative", async () => {
    const { jobsInsert } = mockSupabase({
      named: pkg({ facts_json: CLEAN_FACTS, narrative_json: UNSAFE_NARRATIVE }),
    });

    const res = await POST(req(), params);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("PACKAGE_REVIEW_REQUIRED");
    expect(body.reasons).toContain("affirmative_address_delivery_claim");
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);

    // The whole point: no job, so no optimistic submitted state downstream.
    expect(jobsInsert).not.toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "defence_package_blocked_unsafe_claim",
        eventPayload: expect.objectContaining({ trigger: "embedded_submit" }),
      }),
    );
  });

  it("returns 422 for a retired delivery fact", async () => {
    const { jobsInsert } = mockSupabase({
      named: pkg({ facts_json: RETIRED_FACTS, narrative_json: CLEAN_NARRATIVE }),
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(422);
    expect((await res.json()).reasons).toContain("retired_delivery_fact");
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("returns 422 for an UNREADABLE candidate — fails closed", async () => {
    const { jobsInsert } = mockSupabase({
      named: pkg({ facts_json: null, narrative_json: null }),
    });
    const res = await POST(req(), params);
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.reasons).toEqual(
      expect.arrayContaining(["unreadable_facts_json", "unreadable_narrative_json"]),
    );
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("returns 422 when the named package is NOT the current candidate", async () => {
    // The endpoint enqueues against the source pack and the worker re-selects
    // the latest version, so approving a superseded row must be refused rather
    // than silently filing a different one.
    const { jobsInsert } = mockSupabase({
      named: pkg({ facts_json: CLEAN_FACTS, narrative_json: CLEAN_NARRATIVE }),
      latestId: "pkg-4",
    });
    const res = await POST(req(), params);
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body.reasons).toContain("candidate_not_current");
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("enqueues normally for a safe, current candidate", async () => {
    const { jobsInsert } = mockSupabase({
      named: pkg({ facts_json: CLEAN_FACTS, narrative_json: CLEAN_NARRATIVE }),
      latestId: PKG_ID,
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(jobsInsert).toHaveBeenCalledTimes(1);
  });
});
