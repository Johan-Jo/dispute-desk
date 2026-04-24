import { describe, it, expect } from "vitest";
import {
  buildEvidenceInput,
  buildEvidenceInputFromRaw,
  type PackSection,
  type RawPackSection,
} from "@/lib/shopify/fieldMapping";

describe("buildEvidenceInput", () => {
  it("maps pack sections to Shopify evidence fields", () => {
    const sections: PackSection[] = [
      { key: "refund_policy", label: "Refund Policy", content: "30-day refund policy applies." },
      { key: "cancellation_rebuttal", label: "Cancellation Rebuttal", content: "Customer did not request cancellation." },
      { key: "other", label: "Additional", content: "Supporting evidence text." },
      { key: "notes", label: "Notes", content: "   " },
    ];

    const input = buildEvidenceInput(sections);
    expect(input.refundPolicyDisclosure).toBe("30-day refund policy applies.");
    expect(input.cancellationRebuttal).toBe("Customer did not request cancellation.");
    expect(input.uncategorizedText).toBe("Supporting evidence text.");
  });

  it("respects disabledFields set", () => {
    const sections: PackSection[] = [
      { key: "refund_policy", label: "Refund Policy", content: "30-day policy." },
      { key: "other", label: "Other", content: "Extra text." },
    ];

    const disabled = new Set(["refundPolicyDisclosure"]);
    const input = buildEvidenceInput(sections, disabled);
    expect(input.refundPolicyDisclosure).toBeUndefined();
    expect(input.uncategorizedText).toBe("Extra text.");
  });

  it("returns empty object when no sections match", () => {
    const sections: PackSection[] = [
      { key: "unknown_section", label: "Unknown", content: "Some data" },
    ];
    const input = buildEvidenceInput(sections);
    expect(Object.keys(input)).toHaveLength(0);
  });
});

describe("buildEvidenceInputFromRaw", () => {
  /** The combined policy section that owns Shopify serialization. */
  const combinedPolicy: RawPackSection = {
    type: "policy",
    label: "Store Policies (3)",
    source: "policy_snapshots",
    data: {
      policies: [
        { policyType: "refunds" },
        { policyType: "shipping" },
        { policyType: "terms" },
      ],
    },
  };

  /**
   * Display-only per-policy-type sections emitted by policySource so the
   * Evidence tab can render individual rows. These carry __displayOnly and
   * MUST NOT contribute to the Shopify payload — otherwise refundPolicyDisclosure
   * would double-emit the refund-policy summary.
   */
  const displayOnlyPerType: RawPackSection[] = [
    {
      type: "refund_policy",
      label: "Refund Policy",
      source: "policy_snapshots",
      data: { __displayOnly: true, policies: [{ policyType: "refunds" }] },
    },
    {
      type: "shipping_policy",
      label: "Shipping Policy",
      source: "policy_snapshots",
      data: { __displayOnly: true, policies: [{ policyType: "shipping" }] },
    },
    {
      type: "cancellation_policy",
      label: "Cancellation Policy",
      source: "policy_snapshots",
      data: { __displayOnly: true, policies: [{ policyType: "terms" }] },
    },
  ];

  it("combined-only and combined+display-only produce identical refundPolicyDisclosure", () => {
    const combinedOnly = buildEvidenceInputFromRaw([combinedPolicy]);
    const combinedPlusDisplay = buildEvidenceInputFromRaw([
      combinedPolicy,
      ...displayOnlyPerType,
    ]);

    expect(combinedOnly.refundPolicyDisclosure).toBeTruthy();
    expect(combinedPlusDisplay.refundPolicyDisclosure).toBe(
      combinedOnly.refundPolicyDisclosure,
    );
  });

  it("display-only sections contribute nothing when present alone", () => {
    const input = buildEvidenceInputFromRaw(displayOnlyPerType);
    expect(input.refundPolicyDisclosure).toBeUndefined();
    expect(input.cancellationPolicyDisclosure).toBeUndefined();
  });

  it("formats IPinfo evidence as bank-facing prose instead of raw JSON", () => {
    const input = buildEvidenceInputFromRaw([
      {
        type: "other",
        label: "IP & Location Check",
        source: "ipinfo_io",
        fieldsProvided: ["ip_location_check"],
        data: {
          bankEligible: true,
          locationMatch: "same_country",
          ip: "2804:1b3:7000:b37c:51a8:8de9:3646:e9a8",
          ipinfo: {
            ip: "2804:1b3:7000:b37c:51a8:8de9:3646:e9a8",
            loc: "-22.9064,-43.1822",
            org: "AS18881 TELEFÔNICA BRASIL S.A",
            city: "Rio de Janeiro",
            region: "Rio de Janeiro",
            country: "BR",
            privacy: { vpn: false, proxy: false, hosting: false },
          },
        },
      },
    ]);

    expect(input.uncategorizedText).toBe(
      [
        "Device / IP evidence:",
        "The customer session was associated with Rio de Janeiro, Rio de Janeiro, BR on network AS18881 TELEFÔNICA BRASIL S.A.",
        "IP intelligence did not identify VPN, proxy, or hosting infrastructure.",
      ].join("\n"),
    );
    expect(input.uncategorizedText).not.toContain("Ipinfo:");
    expect(input.uncategorizedText).not.toContain("{");
    expect(input.uncategorizedText).not.toContain("2804:1b3");
    expect(input.uncategorizedText).not.toContain("-22.9064");
  });

  it("does not submit negative IPinfo details from the generic raw serializer", () => {
    const input = buildEvidenceInputFromRaw([
      {
        type: "other",
        label: "IP & Location Check",
        source: "ipinfo_io",
        fieldsProvided: ["ip_location_check"],
        data: {
          bankEligible: false,
          locationMatch: "different_country",
          ipinfo: {
            city: "Unknown",
            country: "ZZ",
            privacy: { vpn: true, proxy: false, hosting: false },
          },
        },
      },
    ]);

    expect(input.uncategorizedText).toBe(
      "Device and access patterns were reviewed as part of the transaction assessment.",
    );
    expect(input.uncategorizedText).not.toMatch(/different.country|VPN|proxy|hosting|Unknown|ZZ/i);
    expect(input.uncategorizedText).not.toContain("{");
  });
});
