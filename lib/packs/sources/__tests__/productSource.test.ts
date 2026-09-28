/**
 * Not-as-described plan PR 3 — the source's gates and its one retry
 * (acceptance #2, #7).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn(() => ({})) }));
vi.mock("@/lib/jobs/claimJobs", () => ({ enqueueJob: vi.fn() }));
vi.mock("../../productListing/collectProductListings", () => ({ collectProductListings: vi.fn() }));

import { collectProductEvidence, productRetryDedupeKey } from "../productSource";
import { enqueueJob } from "@/lib/jobs/claimJobs";
import { collectProductListings } from "../../productListing/collectProductListings";
import { normalizeEvidencePayload } from "@/lib/evidence/model/payloads";
import { classifyFacts } from "@/lib/defence/factClassifier";
import { resolveReasonCodeModuleForContext } from "@/lib/defence/reasonCodes/registry";
import type { BuildContext } from "../../types";

const mockCollect = vi.mocked(collectProductListings);
const mockEnqueue = vi.mocked(enqueueJob);

const ctx = (over: Partial<BuildContext> = {}) =>
  ({
    packId: "pack-1",
    disputeId: "disp-1",
    shopId: "shop-1",
    orderGid: "gid://shopify/Order/1",
    shopDomain: "s.myshopify.com",
    accessToken: "t",
    caseFamily: "product_not_as_described",
    ...over,
  }) as BuildContext;

const LISTING = {
  snapshotId: "snap-1",
  lineItemGid: "li-1",
  contentHash: "h",
  productGid: "p",
  title: "Linen cushion cover",
  variantTitle: "Stone grey",
  variantOptions: [{ name: "Colour", value: "Stone grey" }],
  excerpt: "40 × 40 cm, stone grey.",
  sourceUrl: "https://shop.example/products/cover",
  fetchedAt: "2026-09-28T10:00:00Z",
  imagePaths: [],
  lineTotal: 20,
};

describe("collectProductEvidence gates", () => {
  const prev = process.env.PRODUCT_LISTING_EVIDENCE_ENABLED;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = "true";
  });
  afterEach(() => {
    process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = prev;
  });

  it("flag OFF: returns nothing and makes no call (byte-identical build)", async () => {
    process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = "false";
    expect(await collectProductEvidence(ctx())).toEqual([]);
    expect(mockCollect).not.toHaveBeenCalled();
  });

  it("another family: returns nothing and makes no call", async () => {
    expect(await collectProductEvidence(ctx({ caseFamily: "item_not_received" }))).toEqual([]);
    expect(mockCollect).not.toHaveBeenCalled();
  });

  it("present: one section providing product_description", async () => {
    mockCollect.mockResolvedValue({ outcomes: [{ lineItemGid: "li-1", outcome: "present" }], listings: [LISTING], anyFailed: false });
    const [section] = await collectProductEvidence(ctx());
    expect(section.fieldsProvided).toEqual(["product_description"]);
    expect(section.labelToken).toEqual({ key: "packs.section.productListings", params: { count: 1 } });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("failed: enqueues exactly one retry per pack, with the permanent key", async () => {
    mockCollect.mockResolvedValue({ outcomes: [{ lineItemGid: null, outcome: "failed" }], listings: [], anyFailed: true });
    const [section] = await collectProductEvidence(ctx());
    expect(section.fieldsProvided).toEqual([]);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: "collect_product_evidence", entityId: "pack-1", dedupeKey: productRetryDedupeKey("pack-1") }),
      { onDuplicate: "return" },
    );
  });
});

describe("the evidence model reads collected listings", () => {
  it("a payload without listings is byte-identical to before (no listings key)", () => {
    const p = normalizeEvidencePayload("product_description", { uploads: [] });
    expect(p).toEqual({ fieldKey: "product_description", uploads: [] });
  });

  it("a collected listing is a citable (supporting, never scored) fact", () => {
    const result = classifyFacts({
      packageId: "pkg",
      sections: [
        {
          type: "other",
          label: "Product listings",
          source: "shopify_product",
          data: { listings: [LISTING], outcomes: [] },
          fieldsProvided: ["product_description"],
        },
      ],
      evidenceItems: [],
      checklist: [],
      coverage: { state: "not_covered" },
      fatalLoss: { triggered: false, reason: null },
      caseStrength: "moderate",
      manualRows: [],
      reasonCodeModule: resolveReasonCodeModuleForContext(null, "PRODUCT_UNACCEPTABLE"),
    });
    const f = result.approved.find((x) => x.category === "product_listing");
    expect(f?.strength).toBe("supporting");
    expect(f?.bankEligible).toBe(true);
    expect(f?.value).toMatchObject({ collected: true, title: "Linen cushion cover", variantTitle: "Stone grey" });
  });
});
