/**
 * The page description handed to the writer names a delivered date only when
 * the ledger holds the delivery. #103370 (2026-10-09): no delivery on record,
 * the description still said "shipped and delivered dates", the writer wrote
 * that the card "records its delivery", and the reviewer rejected the letter.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shipmentCardContext, timelineEventsContext } from "../run";

describe("page context follows the recorded delivery", () => {
  it("names the delivered date only when a delivery is on record", () => {
    expect(shipmentCardContext(true)).toContain("shipped and delivered dates");
    expect(shipmentCardContext(false)).toContain("shipped date");
    expect(shipmentCardContext(false)).not.toMatch(/deliver/i);
  });

  it("lists delivery among the timeline's events only when recorded", () => {
    expect(timelineEventsContext(true)).toContain("delivery");
    expect(timelineEventsContext(false)).not.toMatch(/deliver/i);
  });

  it("runCounsel derives it from the ledger's carrier_delivered claim", () => {
    const src = readFileSync(join(__dirname, "..", "run.ts"), "utf8");
    expect(src).toMatch(/deliveryRecorded = ledger\.some\(\(c\) => c\.id === "carrier_delivered"\)/);
    expect(src).not.toMatch(/Shipment card: carrier, tracking number, shipped and delivered dates\. Tracking/);
  });
});
