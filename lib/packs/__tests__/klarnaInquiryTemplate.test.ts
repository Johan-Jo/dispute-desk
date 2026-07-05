import { describe, it, expect } from "vitest";
import {
  resolveKlarnaInquiryTemplateId,
  klarnaInquiryTemplateOverride,
  KLARNA_INQUIRY_TEMPLATE_IDS,
} from "@/lib/packs/klarnaInquiryTemplate";

describe("resolveKlarnaInquiryTemplateId", () => {
  it("maps each supported reason to its Klarna inquiry template", () => {
    expect(resolveKlarnaInquiryTemplateId("PRODUCT_NOT_RECEIVED")).toBe(KLARNA_INQUIRY_TEMPLATE_IDS.pnr);
    expect(resolveKlarnaInquiryTemplateId("CREDIT_NOT_PROCESSED")).toBe(KLARNA_INQUIRY_TEMPLATE_IDS.refund);
    expect(resolveKlarnaInquiryTemplateId("PRODUCT_UNACCEPTABLE")).toBe(KLARNA_INQUIRY_TEMPLATE_IDS.not_as_described);
    expect(resolveKlarnaInquiryTemplateId("FRAUDULENT")).toBe(KLARNA_INQUIRY_TEMPLATE_IDS.unauthorized);
    expect(resolveKlarnaInquiryTemplateId("UNRECOGNIZED")).toBe(KLARNA_INQUIRY_TEMPLATE_IDS.unauthorized);
    expect(resolveKlarnaInquiryTemplateId("DUPLICATE")).toBe(KLARNA_INQUIRY_TEMPLATE_IDS.duplicate);
  });

  it("is case-insensitive", () => {
    expect(resolveKlarnaInquiryTemplateId("product_not_received")).toBe(KLARNA_INQUIRY_TEMPLATE_IDS.pnr);
  });

  it("returns null for unmapped/absent reasons", () => {
    expect(resolveKlarnaInquiryTemplateId("SUBSCRIPTION_CANCELED")).toBeNull();
    expect(resolveKlarnaInquiryTemplateId(null)).toBeNull();
    expect(resolveKlarnaInquiryTemplateId("")).toBeNull();
  });
});

describe("klarnaInquiryTemplateOverride", () => {
  it("overrides only when family=klarna AND phase=inquiry AND reason maps", () => {
    expect(
      klarnaInquiryTemplateOverride({ paymentFamily: "klarna", phase: "inquiry", reason: "PRODUCT_NOT_RECEIVED" }),
    ).toBe(KLARNA_INQUIRY_TEMPLATE_IDS.pnr);
  });

  it("does NOT override a card inquiry", () => {
    expect(
      klarnaInquiryTemplateOverride({ paymentFamily: "card", phase: "inquiry", reason: "PRODUCT_NOT_RECEIVED" }),
    ).toBeNull();
  });

  it("does NOT override a Klarna CHARGEBACK (inquiry-only)", () => {
    expect(
      klarnaInquiryTemplateOverride({ paymentFamily: "klarna", phase: "chargeback", reason: "PRODUCT_NOT_RECEIVED" }),
    ).toBeNull();
  });

  it("does NOT override when the reason has no Klarna variant", () => {
    expect(
      klarnaInquiryTemplateOverride({ paymentFamily: "klarna", phase: "inquiry", reason: "SUBSCRIPTION_CANCELED" }),
    ).toBeNull();
  });

  it("is case-insensitive on phase", () => {
    expect(
      klarnaInquiryTemplateOverride({ paymentFamily: "klarna", phase: "Inquiry", reason: "CREDIT_NOT_PROCESSED" }),
    ).toBe(KLARNA_INQUIRY_TEMPLATE_IDS.refund);
  });

  it("returns null for affirm / other non-card BNPL (Klarna-specific)", () => {
    expect(
      klarnaInquiryTemplateOverride({ paymentFamily: "affirm", phase: "inquiry", reason: "PRODUCT_NOT_RECEIVED" }),
    ).toBeNull();
  });
});
