/**
 * WHY a parcel went back — the sub-reason classifier.
 *
 * The distinction is load-bearing: Klarna's rules make a REFUSED or
 * UNCOLLECTED parcel arguable ("not a valid use of the right of
 * withdrawal … nor a valid return") and an UNDELIVERABLE address
 * argue nothing. Getting `undeliverable` wrong in the optimistic
 * direction would hand a merchant an argument they do not have.
 *
 * The most important assertions here are the NEGATIVE ones. Measured on
 * prod 2026-08-22, every returned shipment we hold carries a bare
 * "Shipment returned to sender" with no sub-reason, so `null` is the
 * answer this must give in the overwhelming majority of real cases.
 */

import { describe, it, expect } from "vitest";
import {
  classifyReturnReason,
  type DeliveryEventLike,
} from "../deliveryEventClassifier";

const ev = (
  message: string | null,
  happenedAt: string | null = "2026-07-01T10:00:00Z",
  status: string | null = null,
): DeliveryEventLike => ({ message, happenedAt, status });

describe("classifyReturnReason — null is the expected answer", () => {
  it("returns null for the exact message prod actually holds", () => {
    // cay-collective #13195, the only real returned shipment in prod.
    expect(
      classifyReturnReason(
        [ev("Shipment returned to sender", "2026-07-06T09:40:00")],
        "2026-07-06T09:40:00",
      ),
    ).toBeNull();
  });

  it("returns null for no events, and for events with no text or code", () => {
    expect(classifyReturnReason([], null)).toBeNull();
    expect(classifyReturnReason(null, null)).toBeNull();
    expect(classifyReturnReason([ev(null), ev("")], null)).toBeNull();
  });

  it("never invents a reason from ordinary transit chatter", () => {
    expect(
      classifyReturnReason(
        [
          ev("Shipment picked up", "2026-06-18T15:00:00Z"),
          ev("Processed at DHL Freight facility", "2026-06-19T08:00:00Z"),
          ev("Out for delivery", "2026-06-20T07:00:00Z"),
          ev("Shipment returned to sender", "2026-07-06T09:40:00Z"),
        ],
        "2026-07-06T09:40:00Z",
      ),
    ).toBeNull();
  });
});

describe("classifyReturnReason — structured codes beat text", () => {
  it("reads a DHL Parcel DE code even when the message says nothing", () => {
    expect(
      classifyReturnReason([ev("Sendung bearbeitet", "2026-07-02T09:00:00Z", "ANN")], null),
    ).toBe("refused");
    expect(
      classifyReturnReason([ev(null, "2026-07-02T09:00:00Z", "NZG")], null),
    ).toBe("not_collected");
    expect(
      classifyReturnReason([ev(null, "2026-07-02T09:00:00Z", "UNZ")], null),
    ).toBe("undeliverable");
  });

  it("the code wins over contradicting text on the same event", () => {
    // DHL's own guidance: prefer structured codes to free text.
    expect(
      classifyReturnReason(
        [ev("undeliverable address", "2026-07-02T09:00:00Z", "ANN")],
        null,
      ),
    ).toBe("refused");
  });
});

describe("classifyReturnReason — the reason lives BEFORE the return", () => {
  it("finds the refusal recorded days before the parcel got back", () => {
    expect(
      classifyReturnReason(
        [
          ev("Out for delivery", "2026-06-20T07:00:00Z"),
          ev("Recipient refused acceptance", "2026-06-20T11:00:00Z"),
          ev("Shipment returned to sender", "2026-07-06T09:40:00Z"),
        ],
        "2026-07-06T09:40:00Z",
      ),
    ).toBe("refused");
  });

  it("takes the NEWEST speaking event, not the first in the array", () => {
    expect(
      classifyReturnReason(
        [
          ev("Address incomplete", "2026-06-20T09:00:00Z"),
          ev("Recipient refused acceptance", "2026-06-25T09:00:00Z"),
          ev("Shipment returned to sender", "2026-07-06T09:40:00Z"),
        ],
        "2026-07-06T09:40:00Z",
      ),
    ).toBe("refused");
  });

  it("ignores events AFTER the return — a reship-then-refuse is a different journey", () => {
    expect(
      classifyReturnReason(
        [
          ev("Not collected within the holding period", "2026-06-30T09:00:00Z"),
          ev("Shipment returned to sender", "2026-07-06T09:40:00Z"),
          ev("Recipient refused acceptance", "2026-07-20T09:00:00Z"),
        ],
        "2026-07-06T09:40:00Z",
      ),
    ).toBe("not_collected");
  });
});

describe("classifyReturnReason — multilingual roots", () => {
  const cases: Array<[string, "refused" | "not_collected" | "undeliverable"]> = [
    ["Mottagaren vägrade ta emot försändelsen", "refused"],
    ["Annahme verweigert", "refused"],
    ["Colis refusé par le destinataire", "refused"],
    ["Envío rechazado por el destinatario", "refused"],
    ["Zending geweigerd", "refused"],
    ["Ej uthämtat inom hämtningstiden", "not_collected"],
    ["Nicht abgeholt — Abholfrist abgelaufen", "not_collected"],
    ["Colis non réclamé", "not_collected"],
    ["Paquete no recogido", "not_collected"],
    ["Ikke hentet", "not_collected"],
    ["Unzustellbar — Empfänger unbekannt", "undeliverable"],
    ["Okänd adress", "undeliverable"],
    ["Adresse inconnue", "undeliverable"],
    ["Dirección incorrecta", "undeliverable"],
    ["Undeliverable — bad address", "undeliverable"],
  ];

  it.each(cases)("classifies %s", (message, expected) => {
    expect(classifyReturnReason([ev(message)], null)).toBe(expected);
  });
});

describe("classifyReturnReason — does not overreach", () => {
  it("a customer-initiated RMA is not a carrier return reason", () => {
    // Shopify timeline text, not carrier text. Must not be mistaken for
    // the parcel coming back undelivered.
    expect(
      classifyReturnReason([ev("Thelma Hedén created return #12121-R1.")], null),
    ).toBeNull();
  });

  it("a failed refund mentioning 'returned' is not a parcel event", () => {
    expect(
      classifyReturnReason(
        [ev("The refund for $78.00 USD failed and will be returned to you in your payout.")],
        null,
      ),
    ).toBeNull();
  });

  it("prefers refused over undeliverable when a message carries both", () => {
    // "Refused" is the specific claim about the customer's own conduct;
    // carriers also use undeliverable wording as a generic summary line.
    expect(
      classifyReturnReason([ev("Refused by recipient — undeliverable")], null),
    ).toBe("refused");
  });

  it("an undated event is consulted only when nothing dated speaks", () => {
    expect(
      classifyReturnReason(
        [ev("Recipient refused acceptance", null), ev("Address unknown", "2026-07-01T09:00:00Z")],
        "2026-07-06T09:40:00Z",
      ),
    ).toBe("undeliverable");
  });
});
