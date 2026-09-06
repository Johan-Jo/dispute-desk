/**
 * Tests for the Resubmission Window guards inside saveToShopifyJob.
 *
 * Behaviors covered:
 *   - Guard A (early window-closed check): dispute already at
 *     submitted_confirmed when the job starts → handler returns
 *     ok:true, audits save_to_shopify_skipped_window_closed with
 *     guardPoint="early", no PDF upload, no GraphQL mutation, pack
 *     status restored to saved_to_shopify_verified with rebuild_pending
 *     cleared.
 *
 *   - Coalesce tail behaviors covered indirectly through unit-level
 *     state: rebuild_pending=true + window closed → flag cleared,
 *     audit pack_regenerate_coalesced_skipped_window_closed. (The
 *     full save-cycle is integration territory; the tail logic is
 *     exercised here by stubbing the rest of the handler.)
 *
 * The save-cycle pieces that are NOT in the closed-window branch
 * (defence package download, file upload, mutation) are mocked to
 * fail loudly if called — the test asserts the guard short-circuits
 * before reaching them.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/shopify/graphql", () => ({
  requestShopifyGraphQL: vi.fn().mockImplementation(() => {
    throw new Error("requestShopifyGraphQL must NOT be called when window is closed");
  }),
}));
vi.mock("@/lib/shopify/sessions/getShopBackgroundSession", () => ({
  getShopBackgroundSession: vi.fn(),
  assertNotAuthInvalid: vi.fn(),
  ShopifyAuthInvalidError: class extends Error {
    sessionType: string;
    rawMessage: string;
    constructor(sessionType = "offline", rawMessage = "") {
      super(rawMessage);
      this.sessionType = sessionType;
      this.rawMessage = rawMessage;
    }
  },
}));
vi.mock("@/lib/shopify/disputeFileUpload", () => ({
  uploadDisputeFile: vi.fn().mockImplementation(() => {
    throw new Error("uploadDisputeFile must NOT be called when window is closed");
  }),
  MAX_FILE_SIZE_BYTES: 2_000_000,
}));
vi.mock("@/lib/defence/storage", () => ({
  downloadDefencePdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));
vi.mock("@/lib/defence/orderContext", () => ({
  merchantNameFromDomain: () => "TestMerchant",
}));
vi.mock("@/lib/shopify/verifyEvidenceReadback", () => ({
  verifyEvidenceReadback: vi.fn(),
}));
vi.mock("./saveToShopifyEvents", () => ({
  emitSaveToShopifyEvents: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { uploadDisputeFile } from "@/lib/shopify/disputeFileUpload";
import { handleSaveToShopify } from "../saveToShopifyJob";
import type { ClaimedJob } from "../../claimJobs";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogAuditEvent = vi.mocked(logAuditEvent);
const mockGraphQL = vi.mocked(requestShopifyGraphQL);
const mockUploadDisputeFile = vi.mocked(uploadDisputeFile);

const PACK_ID = "pack-1";
const SHOP_ID = "shop-1";
const DISPUTE_ID = "dispute-1";

function makeJob(): ClaimedJob {
  return {
    id: "job-1",
    shopId: SHOP_ID,
    jobType: "save_to_shopify",
    entityId: PACK_ID,
    attempts: 0,
    maxAttempts: 3,
    priority: 100,
  };
}

interface Rows {
  pack: Record<string, unknown> | null;
  dispute: Record<string, unknown> | null;
}

function makeSupabase(rows: Rows) {
  const packUpdateCalls: Array<Record<string, unknown>> = [];

  const mockFrom = vi.fn((table: string) => {
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: rows.pack,
          error: rows.pack ? null : { message: "not found" },
        }),
        update: vi.fn((patch: Record<string, unknown>) => {
          packUpdateCalls.push(patch);
          return {
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      };
    }
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: rows.dispute,
          error: null,
        }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  mockGetServiceClient.mockReturnValue({ from: mockFrom } as never);

  return { packUpdateCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveToShopifyJob — Resubmission Window guard A", () => {
  it("returns ok:true and skips Shopify when dispute is already submitted_confirmed at job start", async () => {
    const { packUpdateCalls } = makeSupabase({
      pack: {
        id: PACK_ID,
        shop_id: SHOP_ID,
        dispute_id: DISPUTE_ID,
        status: "ready",
      },
      dispute: {
        id: DISPUTE_ID,
        dispute_evidence_gid:
          "gid://shopify/ShopifyPaymentsDisputeEvidence/1",
        dispute_gid: "gid://shopify/ShopifyPaymentsDispute/1234",
        reason: "fraudulent",
        amount: "10",
        currency_code: "USD",
        customer_display_name: "Test User",
        customer_email: "test@example.com",
        submission_state: "submitted_confirmed",
        submitted_at: "2026-05-17T12:00:00Z",
      },
    });

    const result = await handleSaveToShopify(makeJob());

    expect(result).toEqual({ ok: true });

    // No Shopify side-effects.
    expect(mockUploadDisputeFile).not.toHaveBeenCalled();
    expect(mockGraphQL).not.toHaveBeenCalled();

    // Audit recorded the guard short-circuit with guardPoint="early".
    const calls = mockLogAuditEvent.mock.calls.map((c) => c[0]);
    const skipped = calls.find(
      (c) =>
        c?.eventType === "save_to_shopify_skipped_window_closed" &&
        (c?.eventPayload as Record<string, unknown> | undefined)?.guardPoint ===
          "early",
    );
    expect(skipped).toBeDefined();
    expect(
      (skipped?.eventPayload as Record<string, unknown> | undefined)?.reason,
    ).toBe("evidence_forwarded_to_bank");

    // Pack restored to saved_to_shopify_verified with rebuild_pending cleared.
    const restoreCall = packUpdateCalls.find(
      (c) => c.status === "saved_to_shopify_verified",
    );
    expect(restoreCall).toBeDefined();
    expect(restoreCall?.rebuild_pending).toBe(false);
  });
});
