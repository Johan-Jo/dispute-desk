import { describe, expect, it } from "vitest";
import {
  DEVICE_LOCATION_NEUTRAL_MISSING,
  DEVICE_LOCATION_NEUTRAL_REVIEWED,
  buildEvidenceForShopify,
} from "../formatEvidenceForShopify";
import type { RawPackSection } from "../fieldMapping";

// Snapshot the two neutral strings. Any edit to either must fail this
// test — the wording is deliberately vague to avoid leaking merchant
// weakness to the bank.
describe("DEVICE_LOCATION_NEUTRAL_* constants", () => {
  it("matches the exact reviewed sentence", () => {
    expect(DEVICE_LOCATION_NEUTRAL_REVIEWED).toBe(
      "Device and access patterns were reviewed as part of the transaction assessment.",
    );
  });
  it("matches the exact missing sentence", () => {
    expect(DEVICE_LOCATION_NEUTRAL_MISSING).toBe(
      "Device-level location data was not available for this transaction.",
    );
  });
});

function deviceLocSection(data: Record<string, unknown>): RawPackSection {
  return {
    type: "other",
    label: "Device & Location Consistency",
    source: "ipinfo_io",
    fieldsProvided: ["device_location_consistency"],
    data,
  };
}

describe("buildEvidenceForShopify — device-location submission gate", () => {
  it("submits the positive bank paragraph when bankEligible is true (fraud family)", () => {
    const section = deviceLocSection({
      bankEligible: true,
      bankParagraph:
        "These signals support customer legitimacy. The customer's purchase IP resolves to Austin, US — matching the shipping location. This is the first order recorded from this IP for this customer. No VPN, proxy, or data-center flags are set on this IP.",
    });
    const input = buildEvidenceForShopify([section], null, "FRAUDULENT");
    expect(input.accessActivityLog).toContain("support customer legitimacy");
    expect(input.accessActivityLog).toContain("Austin, US");
  });

  it("submits the neutral 'reviewed' fallback when section exists but bankEligible is false", () => {
    const section = deviceLocSection({
      bankEligible: false,
      bankParagraph: null,
      locationMatch: "different_country",
    });
    const input = buildEvidenceForShopify([section], null, "FRAUDULENT");
    expect(input.accessActivityLog).toContain(DEVICE_LOCATION_NEUTRAL_REVIEWED);
    // Crucial: nothing leaking the negative details
    expect(input.accessActivityLog).not.toMatch(/different.country|mismatch|VPN|proxy|variable|inconsisten|hosting/i);
  });

  it("submits the neutral 'missing' fallback when no device-location section is present", () => {
    const input = buildEvidenceForShopify([], null, "FRAUDULENT");
    expect(input.accessActivityLog).toContain(DEVICE_LOCATION_NEUTRAL_MISSING);
    expect(input.accessActivityLog).not.toContain(DEVICE_LOCATION_NEUTRAL_REVIEWED);
  });

  it("submits neither the positive paragraph nor either fallback for non-fraud families", () => {
    const section = deviceLocSection({
      bankEligible: true,
      bankParagraph: "These signals support customer legitimacy.",
    });
    for (const reason of ["PRODUCT_NOT_RECEIVED", "DUPLICATE", "SUBSCRIPTION_CANCELED", "CREDIT_NOT_PROCESSED"]) {
      const input = buildEvidenceForShopify([section], null, reason);
      const activity = input.accessActivityLog ?? "";
      expect(activity).not.toContain("support customer legitimacy");
      expect(activity).not.toContain(DEVICE_LOCATION_NEUTRAL_REVIEWED);
      expect(activity).not.toContain(DEVICE_LOCATION_NEUTRAL_MISSING);
    }
  });

  it("falls back to 'missing' for UNRECOGNIZED (fraud family) when no section is present", () => {
    const input = buildEvidenceForShopify([], null, "UNRECOGNIZED");
    expect(input.accessActivityLog).toContain(DEVICE_LOCATION_NEUTRAL_MISSING);
  });

  it("joins the positive paragraph to existing accessActivityLog with a blank line", () => {
    // Include an order section so accessActivityLog gets populated first.
    const orderSection: RawPackSection = {
      type: "order",
      label: "Order",
      source: "shopify_order",
      fieldsProvided: ["order_confirmation"],
      data: { orderName: "#1001" },
    };
    const device = deviceLocSection({
      bankEligible: true,
      bankParagraph: "These signals support customer legitimacy.",
    });
    const input = buildEvidenceForShopify([orderSection, device], null, "FRAUDULENT");
    expect(input.accessActivityLog).toContain("Order: #1001");
    expect(input.accessActivityLog).toContain("support customer legitimacy");
    // Delimited by a blank line
    expect(input.accessActivityLog).toMatch(/Order: #1001[\s\S]*\n\nThese signals/);
  });
});
