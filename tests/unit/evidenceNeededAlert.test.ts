import { describe, it, expect } from "vitest";
import {
  getNeededEvidenceTypes,
  shouldSendEvidenceAlert,
} from "@/lib/email/sendEvidenceNeededAlert";

const PHYSICAL = ["physical"];
const DIGITAL = ["digital"];
const PHYSICAL_DIGITAL = ["physical", "digital"];

describe("getNeededEvidenceTypes", () => {
  // ── The invented digital_access_logs ask is gone for good ──────────────
  it("NEVER asks for digital_access_logs (it maps to nothing manual; auto-collected)", () => {
    for (const reason of [
      "FRAUDULENT",
      "PRODUCT_UNACCEPTABLE",
      "SUBSCRIPTION_CANCELLED",
      "CREDIT_NOT_PROCESSED",
      "GENERAL",
      "PRODUCT_NOT_RECEIVED",
    ]) {
      const asks = getNeededEvidenceTypes(reason, undefined, PHYSICAL);
      expect(asks).not.toContain("digital_access_logs");
      const asksDigital = getNeededEvidenceTypes(reason, undefined, DIGITAL);
      expect(asksDigital).not.toContain("digital_access_logs");
    }
  });

  it("NEVER asks for a generic support_conversations upload", () => {
    for (const reason of ["FRAUDULENT", "PRODUCT_NOT_RECEIVED", "GENERAL"]) {
      const asks = getNeededEvidenceTypes(reason, undefined, PHYSICAL);
      expect(asks).not.toContain("support_conversations");
    }
  });

  // ── Delivery proof: asked only when genuinely missing + physical ───────
  it("asks for carrier_delivery_proof for physical PNR when delivery proof is NOT already real", () => {
    const asks = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", undefined, PHYSICAL, {
      hasRealDeliveryProof: false,
    });
    expect(asks).toContain("carrier_delivery_proof");
  });

  it("does NOT ask for carrier_delivery_proof when we already have real delivery proof", () => {
    // The blume-box case: delivered_confirmed on file → nothing to ask.
    const asks = getNeededEvidenceTypes("FRAUDULENT", undefined, PHYSICAL, {
      hasRealDeliveryProof: true,
    });
    expect(asks).toEqual([]);
  });

  it("does NOT ask for carrier_delivery_proof for a digital-only store", () => {
    const asks = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", undefined, DIGITAL, {
      hasRealDeliveryProof: false,
    });
    expect(asks).not.toContain("carrier_delivery_proof");
  });

  it("does NOT ask for carrier_delivery_proof when storeTypes is undefined", () => {
    const asks = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", undefined, undefined, {
      hasRealDeliveryProof: false,
    });
    expect(asks).not.toContain("carrier_delivery_proof");
  });

  it("asks for carrier_delivery_proof for mixed physical + digital stores when missing", () => {
    const asks = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", undefined, PHYSICAL_DIGITAL, {
      hasRealDeliveryProof: false,
    });
    expect(asks).toContain("carrier_delivery_proof");
  });

  it("does NOT ask for delivery proof on a non-shipping reason", () => {
    const asks = getNeededEvidenceTypes("SUBSCRIPTION_CANCELLED", undefined, PHYSICAL, {
      hasRealDeliveryProof: false,
    });
    expect(asks).not.toContain("carrier_delivery_proof");
  });

  // ── Fully-covered → nothing to ask (review mode) ───────────────────────
  it("returns empty (review mode) for FRAUDULENT physical with real delivery proof and no pending Gorgias", () => {
    const asks = getNeededEvidenceTypes("FRAUDULENT", undefined, PHYSICAL, {
      hasRealDeliveryProof: true,
      pendingSupportReview: false,
    });
    expect(asks).toEqual([]);
  });

  // ── Pending Gorgias review ─────────────────────────────────────────────
  it("asks to review matched conversations when Gorgias review is pending", () => {
    const asks = getNeededEvidenceTypes("FRAUDULENT", undefined, PHYSICAL, {
      hasRealDeliveryProof: true,
      pendingSupportReview: true,
    });
    expect(asks).toEqual(["review_matched_conversations"]);
  });

  it("asks for BOTH missing delivery proof and pending Gorgias review", () => {
    const asks = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", undefined, PHYSICAL, {
      hasRealDeliveryProof: false,
      pendingSupportReview: true,
    });
    expect(asks).toContain("carrier_delivery_proof");
    expect(asks).toContain("review_matched_conversations");
  });
});

describe("shouldSendEvidenceAlert", () => {
  // The touchpoint always fires after a build; the mailer picks ask vs review
  // mode from the real evidence state. The caller owns pref/dedupe gating.
  it("always returns true (touchpoint is never silently dropped)", () => {
    expect(shouldSendEvidenceAlert("FRAUDULENT", undefined, PHYSICAL)).toBe(true);
    expect(shouldSendEvidenceAlert("PRODUCT_NOT_RECEIVED", undefined, DIGITAL)).toBe(true);
    expect(shouldSendEvidenceAlert(null, undefined, undefined)).toBe(true);
  });
});
