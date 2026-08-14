/**
 * PR-C1 — the save path refuses an unsafe defence-package candidate.
 *
 * A large share of persisted candidates carry a retired delivery boolean, an
 * address-delivery assertion, or supporting JSON that cannot be inspected.
 * Without this gate the next auto-save, manual save, or deadline run would
 * file one. (Counts live in the PR description with their census timestamp.)
 *
 * Every Shopify side-effect is mocked to THROW, so "nothing was written" is
 * asserted structurally rather than by inspecting call counts alone.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/audit/logEvent", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/shopify/graphql", () => ({
  requestShopifyGraphQL: vi.fn().mockImplementation(() => {
    throw new Error("requestShopifyGraphQL must NOT be called for an unsafe candidate");
  }),
}));
vi.mock("@/lib/shopify/sessions/getShopBackgroundSession", () => ({
  getShopBackgroundSession: vi.fn(),
  assertNotAuthInvalid: vi.fn(),
  ShopifyAuthInvalidError: class extends Error {},
}));
vi.mock("@/lib/shopify/disputeFileUpload", () => ({
  uploadDisputeFile: vi.fn().mockImplementation(() => {
    throw new Error("uploadDisputeFile must NOT be called for an unsafe candidate");
  }),
  MAX_FILE_SIZE_BYTES: 2_000_000,
}));
vi.mock("@/lib/defence/storage", () => ({
  downloadDefencePdf: vi.fn().mockImplementation(() => {
    throw new Error("downloadDefencePdf must NOT be called for an unsafe candidate");
  }),
}));
vi.mock("@/lib/defence/orderContext", () => ({ merchantNameFromDomain: () => "TestMerchant" }));
vi.mock("@/lib/shopify/verifyEvidenceReadback", () => ({ verifyEvidenceReadback: vi.fn() }));
vi.mock("./saveToShopifyEvents", () => ({
  emitSaveToShopifyEvents: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { uploadDisputeFile } from "@/lib/shopify/disputeFileUpload";
import { handleSaveToShopify } from "../saveToShopifyJob";
import type { ClaimedJob } from "../../claimJobs";
import {
  narrativeJson,
  CLEAN_FACTS,
  RETIRED_FACTS,
} from "@/tests/fixtures/defencePackageShapes";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockLogAuditEvent = vi.mocked(logAuditEvent);
const mockGraphQL = vi.mocked(requestShopifyGraphQL);
const mockUpload = vi.mocked(uploadDisputeFile);

const PACK_ID = "pack-1";
const SHOP_ID = "shop-1";
const DISPUTE_ID = "dispute-1";

const job = (): ClaimedJob => ({
  id: "job-1",
  shopId: SHOP_ID,
  jobType: "save_to_shopify",
  entityId: PACK_ID,
  attempts: 0,
  maxAttempts: 3,
});

const PACK = {
  id: PACK_ID,
  shop_id: SHOP_ID,
  dispute_id: DISPUTE_ID,
  status: "ready",
};
const DISPUTE = {
  id: DISPUTE_ID,
  dispute_evidence_gid: "gid://shopify/ShopifyPaymentsDisputeEvidence/1",
  dispute_gid: "gid://shopify/ShopifyPaymentsDispute/1",
  reason: "fraudulent",
  amount: "10",
  currency_code: "USD",
  customer_display_name: "Test User",
  customer_email: "t@example.com",
  submission_state: "not_saved",
  submitted_at: null,
};

const UNSAFE_NARRATIVE = narrativeJson({ fulfillmentArgument: "The parcel was delivered to the cardholder's verified address on 12 May 2026." });
const CLEAN_NARRATIVE = narrativeJson({ fulfillmentArgument: "The carrier confirmed delivery on 12 May 2026 (PostNord, tracking 1234567890)." });

function makeSupabase(latestPackage: Record<string, unknown> | null) {
  const packUpdates: Array<Record<string, unknown>> = [];
  const mockFrom = vi.fn((table: string) => {
    if (table === "evidence_packs") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: PACK, error: null }),
        update: vi.fn((patch: Record<string, unknown>) => {
          packUpdates.push(patch);
          return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) };
        }),
      };
    }
    if (table === "disputes") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: DISPUTE, error: null }),
      };
    }
    if (table === "defence_packages") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: latestPackage, error: null }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  mockGetServiceClient.mockReturnValue({ from: mockFrom } as never);
  return { packUpdates };
}

const finalPkg = (over: Record<string, unknown>) => ({
  id: "pkg-1",
  version: 3,
  status: "final",
  pdf_path: "shop/dispute/v3.pdf",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("saveToShopifyJob — PR-C1 unsafe-candidate gate", () => {
  it("refuses a candidate whose narrative asserts an address delivery, and writes nothing to Shopify", async () => {
    makeSupabase(finalPkg({ facts_json: CLEAN_FACTS, narrative_json: UNSAFE_NARRATIVE }));

    const result = await handleSaveToShopify(job());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retriable).toBe(false); // retrying cannot make it safe
    expect(result.reason).toContain("defence_package_unsafe_claim");
    expect(result.reason).toContain("affirmative_address_delivery_claim");

    // No Shopify side-effects at all — the PDF is never even downloaded.
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockGraphQL).not.toHaveBeenCalled();

    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "defence_package_blocked_unsafe_claim",
        eventPayload: expect.objectContaining({ trigger: "save_to_shopify" }),
      }),
    );
  });

  it("refuses a candidate carrying a retired delivery fact even when the narrative is clean", async () => {
    makeSupabase(finalPkg({ facts_json: RETIRED_FACTS, narrative_json: CLEAN_NARRATIVE }));

    const result = await handleSaveToShopify(job());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("retired_delivery_fact");
    expect(mockGraphQL).not.toHaveBeenCalled();
  });

  it("refuses on ambiguous address language — fails closed", async () => {
    makeSupabase(
      finalPkg({
        facts_json: CLEAN_FACTS,
        narrative_json: narrativeJson({ fulfillmentArgument: "Delivery to the customer's address." }),
      }),
    );
    const result = await handleSaveToShopify(job());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toContain("ambiguous_address_delivery_claim");
    expect(mockGraphQL).not.toHaveBeenCalled();
  });

  it("a saved-but-unsent dispute gets NO automatic write — the block does not replace what is already in Shopify", async () => {
    // `submission_state = saved_to_shopify` means our evidence is already in
    // Shopify's form but not yet forwarded. PR-C1 refuses to file the unsafe
    // candidate; it must not touch the previously saved evidence either.
    const { packUpdates } = makeSupabase(
      finalPkg({ facts_json: RETIRED_FACTS, narrative_json: UNSAFE_NARRATIVE }),
    );
    (DISPUTE as Record<string, unknown>).submission_state = "saved_to_shopify";

    const result = await handleSaveToShopify(job());

    expect(result.ok).toBe(false);
    expect(mockGraphQL).not.toHaveBeenCalled(); // no disputeEvidenceUpdate
    expect(mockUpload).not.toHaveBeenCalled(); // no file replaced
    expect(packUpdates).toEqual([]); // no local status rewrite either
    (DISPUTE as Record<string, unknown>).submission_state = "not_saved";
  });

  it("an already-sent dispute is untouched — the pre-existing window guard still wins", async () => {
    // Guard A returns before the safety gate is even reached, so an unsafe
    // candidate on a confirmed-sent dispute produces no write and no error.
    makeSupabase(finalPkg({ facts_json: RETIRED_FACTS, narrative_json: UNSAFE_NARRATIVE }));
    (DISPUTE as Record<string, unknown>).submission_state = "submitted_confirmed";
    (DISPUTE as Record<string, unknown>).submitted_at = "2026-05-17T12:00:00Z";

    const result = await handleSaveToShopify(job());

    expect(result).toEqual({ ok: true });
    expect(mockGraphQL).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    (DISPUTE as Record<string, unknown>).submission_state = "not_saved";
    (DISPUTE as Record<string, unknown>).submitted_at = null;
  });

  it("a regenerated SAFE version is not blocked, even though older unsafe versions exist", async () => {
    // The selector reads the latest version only; version 4 is the clean
    // regeneration that supersedes the blocked version 3.
    makeSupabase(
      finalPkg({ version: 4, facts_json: CLEAN_FACTS, narrative_json: CLEAN_NARRATIVE }),
    );

    const result = await handleSaveToShopify(job());

    // It proceeds past the safety gate — it now fails at the mocked PDF
    // download, which is exactly the next step and proves the gate passed.
    expect(result.ok ? "" : result.reason ?? "").not.toContain("defence_package_unsafe_claim");
    expect(mockLogAuditEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "defence_package_blocked_unsafe_claim" }),
    );
  });
});
