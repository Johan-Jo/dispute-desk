import { describe, it, expect } from "vitest";
import { buildDeliveryPresentation } from "@/lib/argument/deliveryPresentation";

describe("buildDeliveryPresentation", () => {
  it("labels signature-confirmed delivery as the signature key", () => {
    const p = buildDeliveryPresentation({ proofType: "signature_confirmed" });
    expect(p.labelKey).toBe("disputes.deliveryProof.signature");
  });

  it("labels carrier-confirmed delivery as the carrier key", () => {
    const p = buildDeliveryPresentation({ proofType: "delivered_confirmed" });
    expect(p.labelKey).toBe("disputes.deliveryProof.carrierConfirmed");
  });

  it("labels shipped-but-unconfirmed delivery as shippedUnconfirmed", () => {
    const p = buildDeliveryPresentation({ proofType: "delivered_unverified" });
    expect(p.labelKey).toBe("disputes.deliveryProof.shippedUnconfirmed");
  });

  it("labels a label-only fulfillment as labelOnly", () => {
    const p = buildDeliveryPresentation({ proofType: "label_created" });
    expect(p.labelKey).toBe("disputes.deliveryProof.labelOnly");
  });

  it("defaults a manual upload (fileName, no proofType) to shippedUnconfirmed", () => {
    const p = buildDeliveryPresentation({ fileName: "receipt.pdf" });
    expect(p.labelKey).toBe("disputes.deliveryProof.shippedUnconfirmed");
  });

  it("defaults an empty payload to labelOnly", () => {
    expect(buildDeliveryPresentation(null).labelKey).toBe(
      "disputes.deliveryProof.labelOnly",
    );
    expect(buildDeliveryPresentation({}).labelKey).toBe(
      "disputes.deliveryProof.labelOnly",
    );
  });

  it("extracts carrier + number + url from fulfillment tracking (the real prod shape)", () => {
    const p = buildDeliveryPresentation({
      proofType: "delivered_unverified",
      fulfillments: [
        {
          tracking: [
            {
              carrier: "PostNord SE",
              number: "00573132901672098616",
              url: "https://tracking.postnord.com/se/?id=00573132901672098616",
            },
          ],
        },
      ],
    });
    expect(p.trackingLinks).toEqual([
      {
        carrier: "PostNord SE",
        number: "00573132901672098616",
        url: "https://tracking.postnord.com/se/?id=00573132901672098616",
      },
    ]);
  });

  it("dedups repeated tracking numbers across fulfillments", () => {
    const p = buildDeliveryPresentation({
      fulfillments: [
        { tracking: [{ carrier: "UPS", number: "1Z", url: "https://ups.com/1Z" }] },
        { tracking: [{ carrier: "UPS", number: "1Z", url: "https://ups.com/1Z" }] },
      ],
    });
    expect(p.trackingLinks).toHaveLength(1);
  });

  it("falls back to flat trackingNumber/trackingUrl when no fulfillments array", () => {
    const p = buildDeliveryPresentation({
      trackingNumber: "ABC123",
      trackingUrl: "https://carrier.example/ABC123",
      carrier: "DHL",
    });
    expect(p.trackingLinks).toEqual([
      { carrier: "DHL", number: "ABC123", url: "https://carrier.example/ABC123" },
    ]);
  });

  it("rejects non-http tracking urls but keeps the number", () => {
    const p = buildDeliveryPresentation({
      fulfillments: [
        { tracking: [{ carrier: "X", number: "N1", url: "javascript:alert(1)" }] },
      ],
    });
    expect(p.trackingLinks).toEqual([{ carrier: "X", number: "N1", url: null }]);
  });

  it("returns no links when the payload carries no tracking", () => {
    expect(
      buildDeliveryPresentation({ proofType: "label_created" }).trackingLinks,
    ).toEqual([]);
  });
});
