import { describe, it, expect } from "vitest";
import {
  getNeededEvidenceTypes,
  shouldSendEvidenceAlert,
} from "@/lib/email/sendEvidenceNeededAlert";

const PHYSICAL = ["physical"];
const DIGITAL = ["digital"];
const PHYSICAL_DIGITAL = ["physical", "digital"];

describe("getNeededEvidenceTypes", () => {
  it("returns digital_access_logs for digital-eligible disputes when merchant said yes", () => {
    const types = getNeededEvidenceTypes("SUBSCRIPTION_CANCELED", "yes", DIGITAL);
    expect(types).toContain("digital_access_logs");
  });

  it("returns digital_access_logs for sometimes digital proof", () => {
    const types = getNeededEvidenceTypes(
      "PRODUCT_UNACCEPTABLE",
      "sometimes",
      DIGITAL
    );
    expect(types).toContain("digital_access_logs");
  });

  it("does NOT return digital_access_logs when merchant said no", () => {
    const types = getNeededEvidenceTypes("SUBSCRIPTION_CANCELED", "no", DIGITAL);
    expect(types).not.toContain("digital_access_logs");
  });

  it("returns carrier_delivery_proof for PNR when merchant sells physical goods", () => {
    const types = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", "no", PHYSICAL);
    expect(types).toContain("carrier_delivery_proof");
  });

  it("does NOT return carrier_delivery_proof for a digital-only store", () => {
    // Even if the issuer miscodes a digital dispute as PNR, a digital-only
    // store has nothing to upload — never ask.
    const types = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", "no", DIGITAL);
    expect(types).not.toContain("carrier_delivery_proof");
  });

  it("does NOT return carrier_delivery_proof when storeTypes is undefined", () => {
    // Defensive: missing profile should not generate a shipping ask.
    const types = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", "no");
    expect(types).not.toContain("carrier_delivery_proof");
  });

  it("returns carrier_delivery_proof for mixed physical + digital stores", () => {
    const types = getNeededEvidenceTypes(
      "PRODUCT_NOT_RECEIVED",
      "no",
      PHYSICAL_DIGITAL
    );
    expect(types).toContain("carrier_delivery_proof");
  });

  it("returns support_conversations for most dispute types", () => {
    const types = getNeededEvidenceTypes("FRAUDULENT", "yes", PHYSICAL);
    expect(types).toContain("support_conversations");
  });

  it("digital-only store + SUBSCRIPTION_CANCELED + digitalProof=no → only support_conversations", () => {
    const types = getNeededEvidenceTypes("SUBSCRIPTION_CANCELED", "no", DIGITAL);
    expect(types).not.toContain("digital_access_logs");
    expect(types).not.toContain("carrier_delivery_proof");
    expect(types).toContain("support_conversations");
  });
});

describe("shouldSendEvidenceAlert", () => {
  it("returns true when evidence types are needed", () => {
    expect(shouldSendEvidenceAlert("SUBSCRIPTION_CANCELED", "yes", DIGITAL)).toBe(
      true
    );
  });

  it("returns true for PNR on a physical-goods store", () => {
    expect(shouldSendEvidenceAlert("PRODUCT_NOT_RECEIVED", "no", PHYSICAL)).toBe(
      true
    );
  });

  it("returns true when only support conversations are needed", () => {
    expect(shouldSendEvidenceAlert("FRAUDULENT", "no", PHYSICAL)).toBe(true);
  });
});
