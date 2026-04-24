/**
 * Tests for extractEvidenceDataFromPack (pack_json → EvidenceData).
 */

import { describe, it, expect } from "vitest";
import { extractEvidenceDataFromPack } from "../evidenceDataFromPack";

interface RawSection {
  type?: string;
  label?: string;
  source?: string;
  fieldsProvided?: string[];
  data?: Record<string, unknown> | null;
}

function paymentSection(overrides: Partial<RawSection> = {}): RawSection {
  return {
    type: "other",
    label: "Payment Verification (AVS/CVV)",
    source: "shopify_transactions",
    fieldsProvided: ["avs_cvv_match"],
    data: {
      avsResultCode: "Y",
      cvvResultCode: "M",
      avsCvvStatus: "available",
      gateway: "shopify_payments",
    },
    ...overrides,
  };
}

function ipSection(overrides: Partial<RawSection> = {}): RawSection {
  return {
    type: "other",
    label: "IP & Location Check",
    source: "ipinfo_io",
    fieldsProvided: ["ip_location_check"],
    data: {
      ip: "203.0.113.7",
      ipinfo: {
        ip: "203.0.113.7",
        city: "Stockholm",
        region: "Stockholm County",
        country: "SE",
        org: "AS3301 TELIA NET",
        privacy: { vpn: false, proxy: false, hosting: false },
      },
      shippingAddress: { city: "Stockholm", region: null, country: "SE" },
    },
    ...overrides,
  };
}

function orderSection(overrides: Partial<RawSection> = {}): RawSection {
  return {
    type: "order",
    label: "Order #1001",
    source: "shopify_order",
    fieldsProvided: ["order_confirmation"],
    data: {
      financialStatus: "PAID",
      shippingAddress: { city: "Stockholm", countryCode: "SE" },
    },
    ...overrides,
  };
}

describe("extractEvidenceDataFromPack", () => {
  it("returns empty signals when no sections are provided", () => {
    const result = extractEvidenceDataFromPack([]);
    expect(result.avsCode).toBeNull();
    expect(result.cvvCode).toBeNull();
    expect(result.authorizationSucceeded).toBeUndefined();
    expect(result.captureSucceeded).toBeUndefined();
    expect(result.ipCity).toBeNull();
    expect(result.ipCountry).toBeNull();
    expect(result.ipNoVpnProxyHosting).toBeNull();
    expect(result.ipCountryMatchesShipping).toBeNull();
    expect(result.hasOrderConfirmation).toBeUndefined();
    expect(result.hasCustomerEmail).toBeUndefined();
    expect(result.hasSupportingDocs).toBeUndefined();
  });

  it("handles null/undefined sections", () => {
    expect(extractEvidenceDataFromPack(null).avsCode).toBeNull();
    expect(extractEvidenceDataFromPack(undefined).captureSucceeded).toBeUndefined();
  });

  it("optional dispute argument enriches hasCustomerEmail when pack omits email", () => {
    const sections = [paymentSection(), orderSection()];
    expect(extractEvidenceDataFromPack(sections).hasCustomerEmail).toBeUndefined();
    expect(
      extractEvidenceDataFromPack(sections, {
        id: "dispute-1",
        reason: "FRAUDULENT",
        shop_id: "shop-1",
        customer_email: "synced@example.com",
      }).hasCustomerEmail,
    ).toBe(true);
  });

  it("extracts AVS and CVV codes from the payment-verification section", () => {
    const result = extractEvidenceDataFromPack([paymentSection()]);
    expect(result.avsCode).toBe("Y");
    expect(result.cvvCode).toBe("M");
  });

  it("sets authorizationSucceeded=true when avsCvvStatus is 'available'", () => {
    expect(extractEvidenceDataFromPack([paymentSection()]).authorizationSucceeded).toBe(true);
  });

  it("sets authorizationSucceeded=true when avsCvvStatus is 'unavailable_from_gateway'", () => {
    const result = extractEvidenceDataFromPack([
      paymentSection({
        data: {
          avsResultCode: null,
          cvvResultCode: null,
          avsCvvStatus: "unavailable_from_gateway",
        },
      }),
    ]);
    expect(result.authorizationSucceeded).toBe(true);
    expect(result.avsCode).toBeNull();
    expect(result.cvvCode).toBeNull();
  });

  it("leaves authorizationSucceeded undefined when avsCvvStatus is 'not_applicable'", () => {
    const result = extractEvidenceDataFromPack([
      paymentSection({ data: { avsCvvStatus: "not_applicable" } }),
    ]);
    expect(result.authorizationSucceeded).toBeUndefined();
  });

  it("sets captureSucceeded=true when financialStatus is PAID", () => {
    expect(extractEvidenceDataFromPack([orderSection()]).captureSucceeded).toBe(true);
  });

  it("sets captureSucceeded=true for PARTIALLY_PAID and PARTIALLY_REFUNDED", () => {
    expect(
      extractEvidenceDataFromPack([
        orderSection({ data: { financialStatus: "PARTIALLY_PAID" } }),
      ]).captureSucceeded,
    ).toBe(true);
    expect(
      extractEvidenceDataFromPack([
        orderSection({ data: { financialStatus: "PARTIALLY_REFUNDED" } }),
      ]).captureSucceeded,
    ).toBe(true);
  });

  it("leaves captureSucceeded undefined for PENDING / VOIDED", () => {
    expect(
      extractEvidenceDataFromPack([
        orderSection({ data: { financialStatus: "PENDING" } }),
      ]).captureSucceeded,
    ).toBeUndefined();
    expect(
      extractEvidenceDataFromPack([
        orderSection({ data: { financialStatus: "VOIDED" } }),
      ]).captureSucceeded,
    ).toBeUndefined();
  });

  it("populates IP narrative fields from ipinfo", () => {
    const result = extractEvidenceDataFromPack([ipSection()]);
    expect(result.ipCity).toBe("Stockholm");
    expect(result.ipRegion).toBe("Stockholm County");
    expect(result.ipCountry).toBe("SE");
    expect(result.ipOrg).toBe("AS3301 TELIA NET");
  });

  it("sets ipNoVpnProxyHosting=true only when all three privacy flags are explicitly false", () => {
    expect(extractEvidenceDataFromPack([ipSection()]).ipNoVpnProxyHosting).toBe(true);

    const flagged = extractEvidenceDataFromPack([
      ipSection({
        data: {
          ipinfo: {
            city: "Stockholm",
            country: "SE",
            org: "Telia",
            privacy: { vpn: true, proxy: false, hosting: false },
          },
        },
      }),
    ]);
    expect(flagged.ipNoVpnProxyHosting).toBe(false);
  });

  it("leaves ipNoVpnProxyHosting=null when privacy data is absent", () => {
    const result = extractEvidenceDataFromPack([
      ipSection({
        data: {
          ipinfo: {
            city: "Stockholm",
            country: "SE",
            org: "Telia",
          },
        },
      }),
    ]);
    expect(result.ipNoVpnProxyHosting).toBeNull();
  });

  it("returns ipCountryMatchesShipping=true when IP country matches shipping", () => {
    expect(extractEvidenceDataFromPack([ipSection(), orderSection()]).ipCountryMatchesShipping).toBe(
      true,
    );
  });

  it("returns ipCountryMatchesShipping=false when countries differ", () => {
    const result = extractEvidenceDataFromPack([
      ipSection({
        data: {
          ipinfo: {
            city: "Rio de Janeiro",
            country: "BR",
            org: "Telefonica",
            privacy: { vpn: false, proxy: false, hosting: false },
          },
          shippingAddress: { city: "Stockholm", country: "SE" },
        },
      }),
    ]);
    expect(result.ipCountryMatchesShipping).toBe(false);
  });

  it("returns ipCountryMatchesShipping=null when shipping country is missing", () => {
    const result = extractEvidenceDataFromPack([
      ipSection({
        data: {
          ipinfo: {
            city: "Stockholm",
            country: "SE",
            org: "Telia",
            privacy: { vpn: false, proxy: false, hosting: false },
          },
          shippingAddress: null,
        },
      }),
    ]);
    expect(result.ipCountryMatchesShipping).toBeNull();
  });

  it("falls back to order section shipping country when IP section omits snapshot", () => {
    const result = extractEvidenceDataFromPack([
      ipSection({
        data: {
          ipinfo: {
            city: "Stockholm",
            country: "SE",
            org: "Telia",
            privacy: { vpn: false, proxy: false, hosting: false },
          },
          shippingAddress: null,
        },
      }),
      orderSection({
        data: {
          financialStatus: "PAID",
          shippingAddress: { city: "Stockholm", countryCode: "SE" },
        },
      }),
    ]);
    expect(result.ipCountryMatchesShipping).toBe(true);
  });

  it("does not fabricate IP fields when no IP section exists", () => {
    const result = extractEvidenceDataFromPack([orderSection(), paymentSection()]);
    expect(result.ipCity).toBeNull();
    expect(result.ipCountry).toBeNull();
    expect(result.ipOrg).toBeNull();
    expect(result.ipNoVpnProxyHosting).toBeNull();
    expect(result.ipCountryMatchesShipping).toBeNull();
  });

  it("recognises legacy 'Device & Location Consistency' label", () => {
    const result = extractEvidenceDataFromPack([
      ipSection({ label: "Device & Location Consistency" }),
    ]);
    expect(result.ipCity).toBe("Stockholm");
    expect(result.ipCountry).toBe("SE");
  });

  it("sets hasOrderConfirmation when an order section exists", () => {
    expect(extractEvidenceDataFromPack([orderSection()]).hasOrderConfirmation).toBe(true);
  });

  it("sets hasCustomerEmail when order has customerEmail", () => {
    const result = extractEvidenceDataFromPack([
      orderSection({
        data: {
          financialStatus: "PAID",
          customerEmail: "buyer@example.com",
          shippingAddress: { city: "Stockholm", countryCode: "SE" },
        },
      }),
    ]);
    expect(result.hasCustomerEmail).toBe(true);
  });

  it("sets hasSupportingDocs when a manual_upload section exists", () => {
    const manual: RawSection = {
      type: "other",
      label: "Manual uploads",
      source: "manual_upload",
      data: { files: [] },
    };
    expect(extractEvidenceDataFromPack([manual]).hasSupportingDocs).toBe(true);
  });
});
