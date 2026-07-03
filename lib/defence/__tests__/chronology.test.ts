import { describe, it, expect } from "vitest";
import {
  buildChronologyEvents,
  normalizeChronologyText,
} from "../chronology";

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

describe("buildChronologyEvents — rich timeline normalization", () => {
  it("normalizes the redundant kr prefix in Shopify timeline events", () => {
    const events = buildChronologyEvents({
      timelineEvents: [
        { at: "2026-05-08T21:01:44Z", text: "A kr628.00 SEK payment was processed on Klarna." },
        { at: "2026-05-08T21:01:42Z", text: "kr605.22 SEK will be added to your May 18, 2026 payout." },
      ],
    });
    // Sorted ascending by `at`, with the redundant kr stripped.
    expect(events.map((e) => e.text)).toEqual([
      "605.22 SEK will be added to your May 18, 2026 payout.",
      "A 628.00 SEK payment was processed on Klarna.",
    ]);
  });
});
