import { describe, it, expect } from "vitest";
import {
  classifyDeliveryEvent,
  classifyDeliveryTimeline,
} from "@/lib/shopify/deliveryEventClassifier";

const ev = (message: string | null, happenedAt: string | null = null, status: string | null = null) => ({
  message,
  happenedAt,
  status,
});

describe("classifyDeliveryEvent — single event", () => {
  it("classifies PostNord final delivery (Swedish)", () => {
    expect(classifyDeliveryEvent(ev("Försändelsen har levererats."))).toBe("delivered");
  });

  it("classifies PostNord service-point delivery as pickup, NOT final", () => {
    // Contains "levererats" but the serviceställe suffix must win.
    expect(
      classifyDeliveryEvent(ev("Försändelsen har levererats till ett serviceställe.")),
    ).toBe("delivered_to_pickup");
  });

  it("classifies return-to-sender (Swedish), even with no delivered verb", () => {
    expect(
      classifyDeliveryEvent(ev("Ditt paket har returnerats till avsändaren eftersom det inte hämtades i tid.")),
    ).toBe("returned");
  });

  it("classifies could-not-deliver as failed (Swedish)", () => {
    expect(classifyDeliveryEvent(ev("Det gick inte att leverera."))).toBe("failed");
  });

  it("classifies in-transit as other", () => {
    expect(classifyDeliveryEvent(ev("Försändelsen är på väg."))).toBe("other");
    expect(classifyDeliveryEvent(ev("Lastad på bil, utkörning påbörjad."))).toBe("other");
  });

  // ── The confirmed cross-carrier false-positive traps ──────────────
  it("UPS 'Delivered to a UPS Access Point' → pickup, NOT delivered", () => {
    expect(
      classifyDeliveryEvent(ev("Your package was delivered to a UPS Access Point")),
    ).toBe("delivered_to_pickup");
  });

  it("GLS ParcelShop 'delivered in the GLS PaketShop' → pickup", () => {
    expect(
      classifyDeliveryEvent(ev("Das Paket wurde im GLS PaketShop zugestellt.")),
    ).toBe("delivered_to_pickup");
  });

  it("DHL neighbour delivery → pickup (not into cardholder hands)", () => {
    expect(
      classifyDeliveryEvent(ev("The parcel has been delivered at the neighbour's (see signature)")),
    ).toBe("delivered_to_pickup");
    expect(
      classifyDeliveryEvent(ev("Das Paket wurde beim Nachbarn erfolgreich zugestellt.")),
    ).toBe("delivered_to_pickup");
  });

  it("PostNL 'Bezorgd bij PostNL-punt' → pickup despite 'bezorgd'", () => {
    expect(classifyDeliveryEvent(ev("Bezorgd bij PostNL-punt"))).toBe("delivered_to_pickup");
  });

  it("Colissimo 'livré au point relais' → pickup despite 'livré'", () => {
    expect(classifyDeliveryEvent(ev("Votre colis est livré au point de retrait"))).toBe(
      "delivered_to_pickup",
    );
  });

  it("Bring DELIVERED_SENDER machine code → returned, NOT delivered", () => {
    expect(classifyDeliveryEvent(ev("DELIVERED_SENDER"))).toBe("returned");
  });

  it("plain final delivery across languages → delivered", () => {
    expect(classifyDeliveryEvent(ev("Delivered"))).toBe("delivered");
    expect(classifyDeliveryEvent(ev("Die Sendung wurde erfolgreich zugestellt."))).toBe("delivered");
    expect(classifyDeliveryEvent(ev("Votre colis a été livré"))).toBe("delivered");
    expect(classifyDeliveryEvent(ev("Objeto entregue ao destinatário"))).toBe("delivered");
    expect(classifyDeliveryEvent(ev("Pakken er levert i postkassen din"))).toBe("delivered");
  });

  it("falls back to DELIVERED status enum only when message is empty", () => {
    expect(classifyDeliveryEvent(ev(null, "2026-01-01T00:00:00Z", "DELIVERED"))).toBe("delivered");
    // A FAILURE status with no message is NOT treated as returned/failed
    // (the enum is unreliable — see classifier header).
    expect(classifyDeliveryEvent(ev(null, "2026-01-01T00:00:00Z", "FAILURE"))).toBe("other");
  });
});

describe("classifyDeliveryTimeline — the real cay-collective order #12936", () => {
  // Reconstructed from the live Shopify fulfillment.events for order
  // 8210936758538 (PostNord). The parcel was returned-to-sender in June,
  // then re-sent and finally delivered 2026-07-06. The status enum was a
  // stale FAILURE on every post-return event — so message text is the only
  // truth, and the LATEST delivery-relevant event must win.
  const events = [
    ev("Försändelsen har lämnats av avsändaren.", "2026-06-07T17:16:52Z", "IN_TRANSIT"),
    ev("Försändelsen är på väg.", "2026-06-08T13:30:00Z", "IN_TRANSIT"),
    ev("Avisering skickad via APP.", "2026-06-09T10:31:33Z", "READY_FOR_PICKUP"),
    ev("Ditt paket har returnerats till avsändaren eftersom det inte hämtades i tid.", "2026-06-17T06:05:42Z", "FAILURE"),
    ev("Det gick inte att leverera.", "2026-06-18T12:50:08Z", "FAILURE"),
    ev("Ditt paket har returnerats till avsändaren eftersom det inte hämtades i tid.", "2026-06-30T08:26:01Z", "FAILURE"),
    ev("Försändelsen har levererats till ett serviceställe.", "2026-07-01T10:00:00Z", "FAILURE"),
    ev("Försändelsen har levererats.", "2026-07-06T18:16:00Z", "FAILURE"),
  ];

  it("resolves to delivered with the 2026-07-06 timestamp (latest wins)", () => {
    const r = classifyDeliveryTimeline(events);
    expect(r.finalCategory).toBe("delivered");
    expect(r.finalAt).toBe("2026-07-06T18:16:00Z");
  });

  it("if the timeline STOPS at the return, it resolves to returned", () => {
    const r = classifyDeliveryTimeline(events.slice(0, 5)); // up to the June 17/18 return+fail
    expect(r.finalCategory).toBe("returned");
  });

  it("if it stops at the service-point delivery, it resolves to pickup", () => {
    const r = classifyDeliveryTimeline(events.slice(0, 7)); // through 2026-07-01 serviceställe
    expect(r.finalCategory).toBe("delivered_to_pickup");
    expect(r.finalAt).toBe("2026-07-01T10:00:00Z");
  });

  it("returns null final for a purely in-transit timeline", () => {
    const r = classifyDeliveryTimeline([
      ev("Försändelsen är på väg.", "2026-06-08T13:30:00Z"),
      ev("Lastad på bil, utkörning påbörjad.", "2026-06-09T09:47:00Z"),
    ]);
    expect(r.finalCategory).toBeNull();
    expect(r.finalAt).toBeNull();
  });

  it("handles empty / null input", () => {
    expect(classifyDeliveryTimeline(null).finalCategory).toBeNull();
    expect(classifyDeliveryTimeline([]).finalCategory).toBeNull();
  });
});

describe("classifyDeliveryTimeline — the real DHL Freight #12809 acceptance shipment (2026-07-16)", () => {
  // Verbatim from the live DHL Unified Tracking API: the terminal event
  // carries statusCode "delivered" but the message is a SERVICEPOINT
  // collection ("Picked up by receiver", product "DHL Servicepoint
  // Domestic"). Must classify as delivered_to_pickup — never as final
  // delivery to the customer's own address.
  it("classifies 'Picked up by receiver' as pickup despite the delivered status code", () => {
    const r = classifyDeliveryTimeline([
      ev("Picked up by receiver", "2026-06-04T18:12:00", "delivered"),
      ev("Receiver notified", "2026-06-04T10:34:00", "transit"),
      ev("Received at terminal", "2026-06-04T01:58:26", "transit"),
      ev("Received at terminal", "2026-06-03T16:08:08", "transit"),
      ev("Consignment created", "2026-06-03T12:25:59", "pre-transit"),
    ]);
    expect(r.finalCategory).toBe("delivered_to_pickup");
    expect(r.finalAt).toBe("2026-06-04T18:12:00");
  });

  it("classifies recipient-collection variants as pickup across all classifier locales", () => {
    for (const message of [
      "Collected by recipient", // en
      "Picked up by the recipient", // en
      "Uthämtad av mottagaren", // sv
      "Sendungen er hentet av mottaker", // no
      "Pakken er afhentet af modtageren", // da
      "Die Sendung wurde vom Empfänger abgeholt", // de
      "Zending opgehaald door de ontvanger", // nl
      "Colis retiré par le destinataire", // fr
      "Envío recogido por el destinatario", // es
      "Encomenda levantada — retirado pelo destinatário", // pt
      "Objeto retirado pelo destinatario", // pt (unaccented feed)
    ]) {
      expect(classifyDeliveryEvent(ev(message)), message).toBe("delivered_to_pickup");
    }
  });

  it("does NOT misclassify an origin pickup from the shipper", () => {
    // "Picked up" alone (carrier collecting from the SHIPPER) must not
    // read as a receiver collection.
    expect(classifyDeliveryEvent(ev("Picked up", null, "transit"))).not.toBe("delivered_to_pickup");
    expect(classifyDeliveryEvent(ev("Shipment picked up by DHL"))).not.toBe("delivered_to_pickup");
  });
});
