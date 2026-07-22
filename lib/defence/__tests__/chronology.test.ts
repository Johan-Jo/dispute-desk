import { describe, it, expect } from "vitest";
import {
  buildChronologyEvents,
  classifyChronologyEvent,
  formatChronologyTimestamp,
  normalizeChronologyText,
  partitionChronologyEvents,
} from "../chronology";

describe("formatChronologyTimestamp", () => {
  it("renders a raw ISO instant as a clean UTC date-time", () => {
    expect(formatChronologyTimestamp("2026-06-06T07:08:42Z")).toBe(
      "Jun 6, 2026, 07:08 UTC",
    );
  });

  it("pads hours/minutes and keeps UTC regardless of offset in the input", () => {
    // +02:00 local → 00:19 UTC
    expect(formatChronologyTimestamp("2026-06-11T02:19:57+02:00")).toBe(
      "Jun 11, 2026, 00:19 UTC",
    );
  });

  it("returns the input unchanged when it is not a parseable date", () => {
    expect(formatChronologyTimestamp("not-a-date")).toBe("not-a-date");
    expect(formatChronologyTimestamp("")).toBe("");
  });

  it("never emits 'Invalid Date'", () => {
    for (const v of ["", "garbage", "2026-13-99T99:99:99Z"]) {
      expect(formatChronologyTimestamp(v)).not.toMatch(/Invalid Date/);
    }
  });
});

describe("normalizeChronologyText", () => {
  it("strips the redundant 'kr' prefix when the ISO code is also present", () => {
    expect(
      normalizeChronologyText("A kr628.00 SEK payment was processed on Klarna."),
    ).toBe("A 628.00 SEK payment was processed on Klarna.");
    expect(
      normalizeChronologyText("kr605.22 SEK will be added to your May 18, 2026 payout."),
    ).toBe("605.22 SEK will be added to your May 18, 2026 payout.");
  });

  it("handles a space after 'kr' and thousands separators", () => {
    expect(normalizeChronologyText("A kr 1 234,56 SEK payment.")).toBe(
      "A 1 234,56 SEK payment.",
    );
  });

  it("strips every occurrence on a line", () => {
    expect(normalizeChronologyText("kr628.00 SEK and kr10.00 SEK combined.")).toBe(
      "628.00 SEK and 10.00 SEK combined.",
    );
  });

  it("leaves a bare 'kr' amount with no ISO code untouched (don't lose the only currency marker)", () => {
    expect(normalizeChronologyText("Refund of kr50.00 issued.")).toBe(
      "Refund of kr50.00 issued.",
    );
  });

  it("does not touch other currencies", () => {
    expect(normalizeChronologyText("Charged $19.99 USD to the card.")).toBe(
      "Charged $19.99 USD to the card.",
    );
  });
});

describe("buildChronologyEvents — rich timeline normalization + bank hygiene", () => {
  it("normalizes the kr prefix AND drops payout-accounting noise", () => {
    const events = buildChronologyEvents({
      timelineEvents: [
        { at: "2026-05-08T21:01:44Z", text: "A kr628.00 SEK payment was processed on Klarna." },
        { at: "2026-05-08T21:01:42Z", text: "kr605.22 SEK will be added to your May 18, 2026 payout." },
      ],
    });
    // The payment line is kept (kr stripped); the payout-accounting line is
    // NOT bank evidence and is dropped by the allow-list.
    expect(events.map((e) => e.text)).toEqual([
      "A 628.00 SEK payment was processed on Klarna.",
    ]);
  });
});

describe("classifyChronologyEvent — the bank-facing allow-list", () => {
  // Real Blume Box order #345617 timeline (dispute 583859fa, 2026-07-21) —
  // the case that exposed unfiltered noise reaching a bank PDF.
  const KEPT: Array<[string, string]> = [
    ["order_placed", "Robert Wilson placed this order on Online Store (checkout #44331777523905)."],
    ["payment", "$110.89 USD was authorized using a Mastercard ending in 8068."],
    ["payment", "$110.89 USD was captured using a Mastercard ending in 8068."],
    ["fulfillment_shipment", "Deposco Fulfillment marked 2 items as fulfilled from Verde Fulfillment - Deposco."],
    ["shipping_confirmation", "Deposco Fulfillment sent a shipping confirmation email to Robert Wilson (a@b.com)."],
    ["delivery_notification", "Shipment out for delivery email was sent to Robert Wilson (a@b.com)."],
    ["delivery_notification", "Shipment delivered email was sent to Robert Wilson (a@b.com)."],
    ["carrier_delivery", "Carrier confirmed delivery of the shipment to the recipient."],
    ["chargeback", "The customer opened a chargeback totaling $125.89."],
  ];
  const DROPPED: string[] = [
    // Payout accounting — bookkeeping, not evidence; the debit lines
    // previously leaked through a bare /chargeback/ match and emphasized
    // the merchant's loss in a bank document (self-harm).
    "$108.09 USD will be added to your Jun 9, 2026 payout.",
    "$108.09 USD was added to your Jun 9, 2026 payout.",
    "$125.89 USD will be deducted from your next payout because of a chargeback.",
    "$125.89 USD was deducted from your Jun 15, 2026 payout because of a chargeback.",
    // Interim/duplicate payment state.
    "A $110.89 USD capture is pending using a Mastercard ending in 8068.",
    // Storefront chatter with no evidentiary meaning.
    "Confirmation #K1PT2YWLC was generated for this order.",
    "Received new order #345617 by Robert Wilson.",
    "Order confirmation email was sent to Robert Wilson (a@b.com).",
    "This order was archived.",
    // The self-incriminating Protect line (bank non-disclosure).
    "Shopify Protect is no longer active for this order.",
  ];

  it.each(KEPT)("keeps [%s] %s", (category, text) => {
    expect(classifyChronologyEvent(text)).toBe(category);
  });

  it.each(DROPPED)("drops: %s", (text) => {
    expect(classifyChronologyEvent(text)).toBeNull();
  });

  it("partition returns kept + droppedUnknown without losing lines", () => {
    const events = [...KEPT.map(([, t]) => t), ...DROPPED].map((text, i) => ({
      at: `2026-06-0${(i % 9) + 1}T00:00:00Z`,
      text,
    }));
    const { kept, droppedUnknown } = partitionChronologyEvents(events);
    expect(kept.length).toBe(KEPT.length);
    expect(droppedUnknown.length).toBe(DROPPED.length);
  });

  it("buildChronologyEvents applies the filter on the rich path (renderers cannot bypass it)", () => {
    const events = buildChronologyEvents({
      timelineEvents: [
        { at: "2026-06-05T19:33:42Z", text: "Robert Wilson placed this order on Online Store (checkout #44331777523905)." },
        { at: "2026-06-05T19:33:47Z", text: "$108.09 USD will be added to your Jun 9, 2026 payout." },
        { at: "2026-06-13T02:51:21Z", text: "The customer opened a chargeback totaling $125.89." },
        { at: "2026-06-14T01:03:20Z", text: "$125.89 USD was deducted from your Jun 15, 2026 payout because of a chargeback." },
      ],
    });
    expect(events.map((e) => e.text)).toEqual([
      "Robert Wilson placed this order on Online Store (checkout #44331777523905).",
      "The customer opened a chargeback totaling $125.89.",
    ]);
  });
});
