import { describe, it, expect } from "vitest";
import {
  getNeededEvidenceTypes,
  shouldSendEvidenceAlert,
} from "@/lib/email/sendEvidenceNeededAlert";

describe("getNeededEvidenceTypes", () => {
  it("returns digital_access_logs for digital-eligible disputes when merchant said yes", () => {
    const types = getNeededEvidenceTypes("SUBSCRIPTION_CANCELED", "yes", "rarely");
    expect(types).toContain("digital_access_logs");
  });

  it("returns digital_access_logs for sometimes digital proof", () => {
    const types = getNeededEvidenceTypes("PRODUCT_UNACCEPTABLE", "sometimes", "rarely");
    expect(types).toContain("digital_access_logs");
  });

  it("does NOT return digital_access_logs when merchant said no", () => {
    const types = getNeededEvidenceTypes("SUBSCRIPTION_CANCELED", "no", "rarely");
    expect(types).not.toContain("digital_access_logs");
  });

  it("returns carrier_delivery_proof for PNR when merchant has tracking", () => {
    const types = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", "no", "always");
    expect(types).toContain("carrier_delivery_proof");
  });

  it("does NOT return carrier_delivery_proof when delivery proof is rarely", () => {
    const types = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", "no", "rarely");
    expect(types).not.toContain("carrier_delivery_proof");
  });

  it("returns support_conversations for most dispute types", () => {
    const types = getNeededEvidenceTypes("FRAUDULENT", "yes", "always");
    expect(types).toContain("support_conversations");
  });

  it("returns empty array when no evidence needed", () => {
    const types = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", "no", "rarely");
    // PNR with no delivery proof and no digital proof → only support conversations
    expect(types).toContain("support_conversations");
  });

  it("returns empty when digitalProof=no and deliveryProof=rarely for digital dispute", () => {
    // SUBSCRIPTION_CANCELED with no digital proof, rarely delivery → only support_conversations
    const types = getNeededEvidenceTypes("SUBSCRIPTION_CANCELED", "no", "rarely");
    expect(types).not.toContain("digital_access_logs");
    expect(types).not.toContain("carrier_delivery_proof");
    expect(types).toContain("support_conversations");
  });
});

describe("shouldSendEvidenceAlert", () => {
  it("returns true when evidence types are needed", () => {
    expect(shouldSendEvidenceAlert("SUBSCRIPTION_CANCELED", "yes")).toBe(true);
  });

  it("returns true for PNR with delivery proof", () => {
    expect(shouldSendEvidenceAlert("PRODUCT_NOT_RECEIVED", "no", "always")).toBe(true);
  });

  it("returns true when only support conversations are needed", () => {
    // Most disputes trigger support_conversations at minimum
    expect(shouldSendEvidenceAlert("FRAUDULENT", "no", "rarely")).toBe(true);
  });
});
