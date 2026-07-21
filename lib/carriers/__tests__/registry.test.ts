import { describe, it, expect, afterEach } from "vitest";
import {
  detectCarrier,
  identifyCarrier,
  registerCarrierAdapter,
  getCarrierAdapter,
} from "@/lib/carriers/registry";
import { createFakeCarrierAdapter } from "@/lib/carriers/fakeCarrier";
import type { CarrierLookupResult } from "@/lib/carriers/types";

const FREIGHT_URL =
  "https://www.dhl.com/se-en/home/tracking.html?tracking-id=373325386394209542";

describe("identifyCarrier (layer 1 — identification)", () => {
  it("identifies DHL divisions from the company string", () => {
    for (const company of ["DHL Freight", "DHL", "DHL Express", "dhl ecommerce"]) {
      expect(identifyCarrier({ company, number: null, url: null })?.slug).toBe("dhl");
    }
  });

  it("identifies carriers with no adapter (PostNord, FedEx, Bring, GLS)", () => {
    expect(identifyCarrier({ company: "PostNord SE", number: null, url: null })?.slug).toBe("postnord");
    expect(identifyCarrier({ company: "FedEx", number: null, url: null })?.slug).toBe("fedex");
    expect(identifyCarrier({ company: "Bring", number: null, url: null })?.slug).toBe("bring");
    expect(identifyCarrier({ company: "GLS", number: null, url: null })?.slug).toBe("gls");
  });

  it("identifies from the tracking-URL hostname when company is empty", () => {
    expect(
      identifyCarrier({ company: null, number: null, url: "https://tracking.postnord.com/se/?id=1" }),
    ).toEqual({ slug: "postnord", identifiedFrom: "url" });
  });

  it("returns null for empty or unrecognizable carriers", () => {
    expect(identifyCarrier({ company: "", number: "123", url: null })).toBeNull();
    expect(identifyCarrier({ company: "Bob's Vans", number: "123", url: "https://bobsvans.example/t/1" })).toBeNull();
  });
});

describe("detectCarrier (layer 2 — adapter resolution)", () => {
  it("matched: DHL Freight entry resolves via the DHL adapter, URL id wins", () => {
    const d = detectCarrier({ company: "DHL Freight", number: "5198980574", url: FREIGHT_URL });
    expect(d.outcome).toBe("matched");
    if (d.outcome === "matched") {
      expect(d.carrier).toBe("dhl");
      expect(d.match.trackingNumber).toBe("373325386394209542");
      expect(d.match.matchedFrom).toBe("url");
    }
  });

  it("unsupported_carrier: UPS is identified but has no adapter (creds unobtainable, shelved 2026-07)", () => {
    const d = detectCarrier({ company: "UPS", number: "1Z31X14FYW96542082", url: null });
    expect(d).toMatchObject({ outcome: "unsupported_carrier", carrier: "ups", identifiedFrom: "company" });
  });

  it("unsupported_carrier: identifiable carrier without a registered adapter", () => {
    const d = detectCarrier({ company: "PostNord SE", number: "PN1", url: null });
    expect(d).toMatchObject({ outcome: "unsupported_carrier", carrier: "postnord", identifiedFrom: "company" });
  });

  it("unsupported_carrier: identified from URL hostname alone", () => {
    const d = detectCarrier({ company: null, number: "F1", url: "https://www.fedex.com/track?nr=F1" });
    expect(d).toMatchObject({ outcome: "unsupported_carrier", carrier: "fedex", identifiedFrom: "url" });
  });

  it("unknown_carrier: tracking exists but carrier is not identifiable", () => {
    expect(detectCarrier({ company: "Bob's Vans", number: "1", url: null }).outcome).toBe("unknown_carrier");
  });

  it("no_tracking: empty entry", () => {
    expect(detectCarrier({ company: null, number: null, url: null }).outcome).toBe("no_tracking");
    expect(detectCarrier({ company: "  ", number: "", url: "" }).outcome).toBe("no_tracking");
  });

  it("identifier_unresolved: identified DHL but conflicting URL ids", () => {
    const d = detectCarrier({
      company: null,
      number: null,
      url: "https://dhl.com/t?tracking-id=X1234&tracking-id=Y5678",
    });
    expect(d).toMatchObject({ outcome: "identifier_unresolved", carrier: "dhl" });
  });
});

describe("carrier-neutrality via the fake adapter (plan §9 PR 1B)", () => {
  let unregister: (() => void) | null = null;
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  it("registry supports multiple adapters; matching and typed outcomes are not DHL-specific", async () => {
    const result: CarrierLookupResult = {
      status: "success",
      shipment: {
        trackingNumber: "FAKE1",
        events: [],
        deliveryStatus: "Delivered",
        terminalAt: "2026-07-01T10:00:00Z",
        podName: null,
      },
    };
    const fetched: string[] = [];
    const fake = createFakeCarrierAdapter({ result, fetched });
    // fake identifies via company token — extend identification through
    // the adapter registry seam only (identification table stays fixed).
    unregister = registerCarrierAdapter(fake);
    expect(getCarrierAdapter("fake_carrier")).toBe(fake);
    // DHL detection still works with the fake registered:
    expect(detectCarrier({ company: "DHL", number: "N1", url: null }).outcome).toBe("matched");
    // The fake adapter's typed outcome round-trips through the same interface:
    const match = fake.match({ company: "FakeCarrier Ltd", number: "FAKE1", url: null });
    expect(match).toMatchObject({ carrier: "fake_carrier", trackingNumber: "FAKE1" });
    const lookup = await fake.fetchTimeline("FAKE1");
    expect(lookup.status).toBe("success");
    expect(fetched).toEqual(["FAKE1"]);
  });

  it("typed error outcomes are adapter-agnostic", async () => {
    const fake = createFakeCarrierAdapter({ result: { status: "rate_limited", retryAfterSeconds: 30 } });
    unregister = registerCarrierAdapter(fake);
    const r = await fake.fetchTimeline("X");
    expect(r).toEqual({ status: "rate_limited", retryAfterSeconds: 30 });
  });
});
