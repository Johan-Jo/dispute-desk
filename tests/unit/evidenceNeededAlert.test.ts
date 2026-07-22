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

  describe("present-fields suppression (don't ask for evidence we already have)", () => {
    it("drops carrier_delivery_proof when delivery_proof is already collected", () => {
      const types = getNeededEvidenceTypes("FRAUDULENT", "no", PHYSICAL, {
        presentFields: new Set(["delivery_proof"]),
      });
      expect(types).not.toContain("carrier_delivery_proof");
      // support conversations still missing → still asked
      expect(types).toContain("support_conversations");
    });

    it("drops carrier_delivery_proof when only shipping_tracking is present", () => {
      const types = getNeededEvidenceTypes("PRODUCT_NOT_RECEIVED", "no", PHYSICAL, {
        presentFields: new Set(["shipping_tracking"]),
      });
      expect(types).not.toContain("carrier_delivery_proof");
    });

    it("drops support_conversations when customer_communication is already collected", () => {
      const types = getNeededEvidenceTypes("FRAUDULENT", "no", PHYSICAL, {
        presentFields: new Set(["customer_communication"]),
      });
      expect(types).not.toContain("support_conversations");
      // delivery proof still missing → still asked
      expect(types).toContain("carrier_delivery_proof");
    });

    it("returns empty when both delivery proof and support comms are present (no digital)", () => {
      // This is the blume-box case: FRAUDULENT with POD + Gorgias comms already
      // attached. Nothing left to ask → mailer sends review-mode, not an upload ask.
      const types = getNeededEvidenceTypes("FRAUDULENT", "no", PHYSICAL, {
        presentFields: new Set(["delivery_proof", "customer_communication"]),
      });
      expect(types).toEqual([]);
    });

    it("never suppresses digital_access_logs — no auto-collected equivalent", () => {
      const types = getNeededEvidenceTypes("SUBSCRIPTION_CANCELED", "yes", DIGITAL, {
        // even with everything else present, digital logs remain a manual ask
        presentFields: new Set(["delivery_proof", "customer_communication"]),
      });
      expect(types).toContain("digital_access_logs");
    });

    it("is identical to today when presentFields is empty or undefined", () => {
      const base = getNeededEvidenceTypes("FRAUDULENT", "yes", PHYSICAL);
      expect(
        getNeededEvidenceTypes("FRAUDULENT", "yes", PHYSICAL, {
          presentFields: new Set(),
        })
      ).toEqual(base);
      expect(
        getNeededEvidenceTypes("FRAUDULENT", "yes", PHYSICAL, undefined)
      ).toEqual(base);
    });
  });

  describe("pending Gorgias review (matched-but-not-approved conversations)", () => {
    it("swaps support_conversations for review_matched_conversations when pending", () => {
      const types = getNeededEvidenceTypes("FRAUDULENT", "no", PHYSICAL, {
        pendingSupportReview: true,
      });
      expect(types).toContain("review_matched_conversations");
      expect(types).not.toContain("support_conversations");
    });

    it("keeps the review ask even when customer_communication is NOT yet present", () => {
      // Matched-but-pending comms are not in the pack, so customer_communication
      // is absent — the review ask must survive suppression.
      const types = getNeededEvidenceTypes("FRAUDULENT", "no", PHYSICAL, {
        pendingSupportReview: true,
        presentFields: new Set(["delivery_proof"]),
      });
      expect(types).toEqual(["review_matched_conversations"]);
    });

    it("does not review-swap once comms are actually approved (present field wins)", () => {
      // If customer_communication IS present, comms are approved/included — no
      // pending review, so nothing about support conversations is asked.
      const types = getNeededEvidenceTypes("FRAUDULENT", "no", PHYSICAL, {
        pendingSupportReview: false,
        presentFields: new Set(["customer_communication", "delivery_proof"]),
      });
      expect(types).not.toContain("support_conversations");
      expect(types).not.toContain("review_matched_conversations");
    });
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
