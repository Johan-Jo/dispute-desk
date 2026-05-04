import { describe, expect, it } from "vitest";
import {
  disputeEvidenceFileExtensionLower,
  isShopifyDisputeEvidenceFileTypeAllowed,
  validateShopifyDisputeEvidenceUpload,
  sumEvidencePayloadFileSizes,
  SHOPIFY_DISPUTE_EVIDENCE_FILE_COMBINED_MAX_BYTES,
} from "@/lib/uploads/shopifyDisputeEvidenceFileConstraints";

describe("shopifyDisputeEvidenceFileConstraints", () => {
  it("allows PNG/JPEG PDF by MIME", () => {
    expect(isShopifyDisputeEvidenceFileTypeAllowed({ type: "image/png", name: "x.gif" })).toBe(true);
    expect(isShopifyDisputeEvidenceFileTypeAllowed({ type: "image/jpeg", name: "a" })).toBe(true);
    expect(isShopifyDisputeEvidenceFileTypeAllowed({ type: "application/pdf", name: "a" })).toBe(true);
  });

  it("allows correct extension when browser omits or misreports MIME", () => {
    expect(
      isShopifyDisputeEvidenceFileTypeAllowed({ type: "", name: "invoice.PDF" }),
    ).toBe(true);
    expect(
      isShopifyDisputeEvidenceFileTypeAllowed({ type: "", name: "pic.JPEG" }),
    ).toBe(true);
    expect(
      isShopifyDisputeEvidenceFileTypeAllowed({ type: "application/octet-stream", name: "p.png" }),
    ).toBe(true);
    expect(isShopifyDisputeEvidenceFileTypeAllowed({ type: "", name: "evil.gif" })).toBe(false);
    expect(isShopifyDisputeEvidenceFileTypeAllowed({ type: "image/gif", name: "spoof.jpeg" })).toBe(false);
  });

  it("validate rejects empty and oversize files", () => {
    expect(validateShopifyDisputeEvidenceUpload({
      type: "image/jpeg",
      name: "a.jpg",
      size: 0,
    }).ok).toBe(false);

    expect(validateShopifyDisputeEvidenceUpload({
      type: "image/jpeg",
      name: "a.jpg",
      size: SHOPIFY_DISPUTE_EVIDENCE_FILE_COMBINED_MAX_BYTES + 1,
    }).ok).toBe(false);

    expect(validateShopifyDisputeEvidenceUpload({
      type: "image/jpeg",
      name: "a.jpg",
      size: SHOPIFY_DISPUTE_EVIDENCE_FILE_COMBINED_MAX_BYTES,
    }).ok).toBe(true);
  });

  it("sumEvidencePayloadFileSizes sums positive numeric fileSize in payload only", () => {
    expect(
      sumEvidencePayloadFileSizes([
        { payload: { fileSize: 100 } },
        { payload: { fileSize: "bad" } },
        { payload: null },
        { payload: { fileSize: -1 } },
      ]),
    ).toBe(100);
  });

  it("disputeEvidenceFileExtensionLower handles paths", () => {
    expect(disputeEvidenceFileExtensionLower("C:\\folder\\doc.PDF")).toBe("pdf");
    expect(disputeEvidenceFileExtensionLower("noext")).toBeNull();
  });
});
