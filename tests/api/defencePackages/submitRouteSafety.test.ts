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
import {
  AMBIGUOUS_NARRATIVE,
  CLEAN_NARRATIVE,
  FULL_FACT,
  RETIRED_FACT,
  UNSAFE_NARRATIVE,
  mockNamedCandidateClient,
  type NamedCandidateScenario,
} from "./namedCandidateMock";

const mockClient = vi.mocked(getServiceClient);
const mockAudit = vi.mocked(logAuditEvent);

const PKG_ID = "pkg-3";

const req = () =>
  new NextRequest("https://x.test/api/defence-packages/pkg-3/submit", { method: "POST" });
const params = { params: Promise.resolve({ id: PKG_ID }) };

/** A genuinely FILEABLE final package: the status check alone was never
 *  enough — `saveToShopifyJob` also requires validation ok and a PDF. */
const pkg = (over: Record<string, unknown>) => ({
  id: PKG_ID,
  version: 3,
  status: "final",
  validation_status: "ok",
  pdf_path: "shop/dispute/v3.pdf",
  source_pack_id: "pack-1",
  shop_id: "shop-1",
  dispute_id: "dispute-1",
  ...over,
});

function wire(s: NamedCandidateScenario) {
  const m = mockNamedCandidateClient(s);
  mockClient.mockReturnValue(m.client);
  return m;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/defence-packages/:id/submit — PR-C1 preflight", () => {
  it("returns 422 and enqueues NOTHING for an unsafe narrative", async () => {
    const { jobsInsert } = wire({
      named: pkg({ facts_json: [FULL_FACT], narrative_json: UNSAFE_NARRATIVE }),
    });

    const res = await POST(req(), params);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.code).toBe("PACKAGE_REVIEW_REQUIRED");
    expect(body.reasons).toContain("affirmative_address_delivery_claim");
    expect(typeof body.message).toBe("string");

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
    const { jobsInsert } = wire({
      named: pkg({ facts_json: [RETIRED_FACT], narrative_json: CLEAN_NARRATIVE }),
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(422);
    expect((await res.json()).reasons).toContain("retired_delivery_fact");
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("returns 422 for ambiguous address language — fails closed", async () => {
    const { jobsInsert } = wire({
      named: pkg({ facts_json: [FULL_FACT], narrative_json: AMBIGUOUS_NARRATIVE }),
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(422);
    expect((await res.json()).reasons).toContain("ambiguous_address_delivery_claim");
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("returns 422 for an UNREADABLE candidate", async () => {
    const { jobsInsert } = wire({
      named: pkg({ facts_json: null, narrative_json: null }),
    });
    const res = await POST(req(), params);
    expect((await res.json()).reasons).toEqual(
      expect.arrayContaining(["unreadable_facts_json", "unreadable_narrative_json"]),
    );
    expect(res.status).toBe(422);
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("returns 422 for a structurally INCOMPLETE fact object", async () => {
    const { jobsInsert } = wire({
      named: pkg({ facts_json: [{ value: "unexpected" }], narrative_json: CLEAN_NARRATIVE }),
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(422);
    expect((await res.json()).reasons).toContain("unreadable_facts_json");
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("returns 422 when the named package is NOT the current candidate", async () => {
    const { jobsInsert } = wire({
      named: pkg({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
      latestId: "pkg-4",
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(422);
    expect((await res.json()).reasons).toContain("candidate_not_current");
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("refuses and enqueues nothing when the NAMED lookup errors", async () => {
    // The route's own package load uses the same query, so a failure there
    // short-circuits at the 404 guard before the preflight is reached. Either
    // way the invariant holds: non-2xx, no job, no state change.
    const { jobsInsert } = wire({
      named: pkg({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
      namedError: { message: "connection reset" },
    });
    const res = await POST(req(), params);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  it("returns 503 when the LATEST-VERSION probe errors — a failed check is not currency", async () => {
    const { jobsInsert } = wire({
      named: pkg({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
      latestError: { message: "timeout" },
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(503);
    expect((await res.json()).reasons).toContain("preflight_error");
    expect(jobsInsert).not.toHaveBeenCalled();
  });

  const NOT_FILEABLE: Array<[string, Record<string, unknown>, string]> = [
    ["final whose VALIDATION failed", { validation_status: "failed" }, "candidate_validation_not_ok"],
    ["final with a NULL validation_status", { validation_status: null }, "candidate_validation_not_ok"],
    ["final with NO pdf_path", { pdf_path: null }, "candidate_missing_pdf"],
    ["final with a BLANK pdf_path", { pdf_path: "   " }, "candidate_missing_pdf"],
  ];

  for (const [name, over, reason] of NOT_FILEABLE) {
    it(`returns 409 PACKAGE_NOT_FILEABLE and enqueues nothing (${name})`, async () => {
      // `status === "final"` passed the route's own gate, so without the
      // central fileability contract this enqueued a job the worker refuses.
      const { jobsInsert } = wire({
        named: pkg({ ...over, facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
      });
      const res = await POST(req(), params);
      const body = await res.json();
      expect(res.status).toBe(409);
      expect(body.code).toBe("PACKAGE_NOT_FILEABLE");
      expect(body.reasons).toContain(reason);
      expect(jobsInsert).not.toHaveBeenCalled();
    });
  }

  it("enqueues normally for a safe, current, genuinely fileable candidate", async () => {
    const { jobsInsert } = wire({
      named: pkg({ facts_json: [FULL_FACT], narrative_json: CLEAN_NARRATIVE }),
    });
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(jobsInsert).toHaveBeenCalledTimes(1);
  });
});
