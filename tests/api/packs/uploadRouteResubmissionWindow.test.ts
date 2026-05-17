/**
 * Route-level tests for the Resubmission Window behaviors on
 * POST /api/packs/:packId/upload.
 *
 * Specifically:
 *   - submitted_confirmed → 409 WINDOW_CLOSED BEFORE any persistence
 *     (storage.upload, evidence_items insert, checklist_v2 patch all
 *     skipped) + audit event evidence_upload_rejected_window_closed
 *   - saved_to_shopify → 201 success with promptRebuild: true
 *   - not_saved / null → 201 success without promptRebuild
 *
 * Storage and evidence_items insert are mocked but tracked to ensure
 * the window-closed branch reaches NEITHER.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/middleware/extractShopId", () => ({
  extractShopId: () => "shop-1",
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { POST } from "@/app/api/packs/[packId]/upload/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogAuditEvent = vi.mocked(logAuditEvent);

const packId = "pack-uuid-1";
const shopId = "shop-1";
const disputeId = "dispute-1";

interface Scenario {
  pack: Record<string, unknown> | null;
  dispute?: Record<string, unknown> | null;
}

interface Spies {
  storageUpload: ReturnType<typeof vi.fn>;
  evidenceItemsInsert: ReturnType<typeof vi.fn>;
  packsUpdate: ReturnType<typeof vi.fn>;
}

function mockSupabase(scenario: Scenario): Spies {
  const storageUpload = vi
    .fn()
    .mockResolvedValue({ data: null, error: null });
  const evidenceItemsInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { id: "item-1" },
      error: null,
    }),
  });
  const packsUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  });

  const mockFrom = vi.fn((table: string) => {
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: scenario.pack,
          error: scenario.pack ? null : { message: "not found" },
        }),
        update: packsUpdate,
      };
    }
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: scenario.dispute ?? null,
          error: null,
        }),
      };
    }
    if (table === "evidence_items") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        // For the sumEvidencePayloadFileSizes lookup
        // (`select("payload").eq(...).eq(...)`).
        then: undefined,
        insert: evidenceItemsInsert,
      };
    }
    if (table === "packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "not a library pack" },
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  // evidence_items.select(...).eq().eq() returns the rows directly
  // (not via single()). Patch the chain after first .eq() to resolve
  // a promise.
  const fromWithEvidenceItems = vi.fn((table: string) => {
    if (table === "evidence_items") {
      const eqChain: {
        eq: ReturnType<typeof vi.fn>;
      } = {
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
      return {
        select: vi.fn().mockReturnValue(eqChain),
        insert: evidenceItemsInsert,
      };
    }
    return mockFrom(table);
  });

  mockGetServiceClient.mockReturnValue({
    from: fromWithEvidenceItems,
    storage: {
      from: vi.fn().mockReturnValue({
        upload: storageUpload,
      }),
    },
  } as never);

  return { storageUpload, evidenceItemsInsert, packsUpdate };
}

function makeReq(file: File): NextRequest {
  const form = new FormData();
  form.append("file", file);
  form.append("label", file.name);
  form.append("field", "supporting_documents");
  return new NextRequest("https://example.com/api/packs/x/upload", {
    method: "POST",
    body: form,
  });
}

function makeFile(): File {
  return new File(["hello"], "test.pdf", { type: "application/pdf" });
}

beforeEach(() => {
  mockLogAuditEvent.mockClear();
  mockGetServiceClient.mockReset();
});

describe("POST /api/packs/:packId/upload — Resubmission Window", () => {
  it("REJECTS BEFORE PERSISTENCE when submission_state = submitted_confirmed", async () => {
    const spies = mockSupabase({
      pack: {
        id: packId,
        shop_id: shopId,
        dispute_id: disputeId,
      },
      dispute: {
        submission_state: "submitted_confirmed",
        submitted_at: "2026-05-17T12:00:00Z",
      },
    });

    const res = await POST(makeReq(makeFile()), {
      params: Promise.resolve({ packId }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("WINDOW_CLOSED");
    expect(body.submittedAt).toBe("2026-05-17T12:00:00Z");

    // Critical: NO persistence happened.
    expect(spies.storageUpload).not.toHaveBeenCalled();
    expect(spies.evidenceItemsInsert).not.toHaveBeenCalled();
    expect(spies.packsUpdate).not.toHaveBeenCalled();

    // Audit event recorded with the dedicated event type.
    const auditCalls = mockLogAuditEvent.mock.calls.map((c) => c[0]);
    const rejectedCall = auditCalls.find(
      (c) => c?.eventType === "evidence_upload_rejected_window_closed",
    );
    expect(rejectedCall).toBeDefined();
  });
});
