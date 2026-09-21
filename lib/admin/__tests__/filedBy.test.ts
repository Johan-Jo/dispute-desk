import { describe, it, expect } from "vitest";
import { resolveFiledBy, isDisputeDeskFiled } from "../filedBy";

describe("resolveFiledBy", () => {
  it("attributes to DisputeDesk when we saved the evidence", () => {
    expect(
      resolveFiledBy({
        evidence_saved_to_shopify_at: "2026-08-15T21:30:31Z",
        submission_state: "saved_to_shopify",
      }),
    ).toBe("disputedesk");
  });

  it("stays DisputeDesk when our save was later confirmed by the platform", () => {
    // The common happy path: we save, Shopify forwards, evidenceSentOn lands
    // and flips submission_state to submitted_confirmed. Still ours.
    expect(
      resolveFiledBy({
        evidence_saved_to_shopify_at: "2026-08-15T21:30:31Z",
        submission_state: "submitted_confirmed",
      }),
    ).toBe("disputedesk");
  });

  it("stays DisputeDesk when the platform never confirmed forwarding", () => {
    // The Shopify bug in submission-confirmation-gap.plan.md: fields land,
    // evidenceSentOn stays null. We still authored the filing.
    expect(
      resolveFiledBy({
        evidence_saved_to_shopify_at: "2026-08-15T21:30:31Z",
        submission_state: null,
      }),
    ).toBe("disputedesk");
  });

  it("attributes to Shopify when confirmed with no save of ours", () => {
    // Shopify auto-filed its own scrape, or a human pressed Submit in Admin.
    expect(
      resolveFiledBy({
        evidence_saved_to_shopify_at: null,
        submission_state: "submitted_confirmed",
      }),
    ).toBe("shopify");
  });

  it("attributes a merchant-reported manual submission to Shopify", () => {
    expect(
      resolveFiledBy({
        evidence_saved_to_shopify_at: null,
        submission_state: "manual_submission_reported",
      }),
    ).toBe("shopify");
  });

  it("returns unknown when neither side recorded anything", () => {
    // 16 such rows on 6a8848-dd: under_review at the issuer, not_saved here.
    expect(
      resolveFiledBy({
        evidence_saved_to_shopify_at: null,
        submission_state: "not_saved",
      }),
    ).toBe("unknown");
  });

  it("returns unknown for an untouched dispute", () => {
    expect(resolveFiledBy({})).toBe("unknown");
  });

  it("does not treat an in-flight save as filed by anyone yet", () => {
    // saved_to_shopify without the timestamp cannot happen via the save job,
    // but a partial row must not be credited to us on the status alone.
    expect(
      resolveFiledBy({
        evidence_saved_to_shopify_at: null,
        submission_state: "saved_to_shopify",
      }),
    ).toBe("unknown");
  });
});

describe("isDisputeDeskFiled", () => {
  it("is true only for DisputeDesk-authored filings", () => {
    expect(isDisputeDeskFiled({ evidence_saved_to_shopify_at: "2026-08-15T21:30:31Z" })).toBe(true);
    expect(isDisputeDeskFiled({ submission_state: "submitted_confirmed" })).toBe(false);
    expect(isDisputeDeskFiled({})).toBe(false);
  });
});
