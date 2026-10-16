/**
 * The brief's sections, as the writer is shown them, presume no delivery the
 * ledger does not hold. #104457 (2026-10-16, Mein Maison, PayPal
 * not-as-described): parcel in transit, the Shipping & Delivery section still
 * said the card shows "shipped and delivered dates" and asked "When did the
 * goods reach the customer?"; the writer answered "the carrier recorded
 * delivery before the dispute was opened" and the reviewer rejected the letter.
 * Same class as the page context's shipment card (#103370).
 */
import { describe, it, expect } from "vitest";
import {
  DELIVERY_CLAIM_IDS,
  GENERAL_BRIEF,
  ITEM_NOT_RECEIVED_BRIEF,
  NOT_AS_DESCRIBED_BRIEF,
  deliveryOnRecord,
  sectionForRecord,
} from "../briefs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BRIEFS = [GENERAL_BRIEF, ITEM_NOT_RECEIVED_BRIEF, NOT_AS_DESCRIBED_BRIEF];
const PRESUMES_DELIVERY = /delivered dates|reach(?:ed)? the customer|the delivery the customer/i;

describe("sectionForRecord", () => {
  it("no delivery on record: no section of any brief names a delivered date or presumes a delivery", () => {
    const none = new Set(["shipped", "shipment_in_transit", "no_return_recorded"]);
    for (const brief of BRIEFS) {
      for (const s of brief.sections) {
        const shown = sectionForRecord(s, none);
        expect(`${brief.type}/${s.key}: ${shown.exhibit} — ${shown.question}`).not.toMatch(PRESUMES_DELIVERY);
      }
    }
  });

  it("delivery on record: sections are shown unchanged", () => {
    for (const id of DELIVERY_CLAIM_IDS) {
      const ids = new Set([id]);
      expect(deliveryOnRecord(ids)).toBe(true);
      for (const brief of BRIEFS) for (const s of brief.sections) expect(sectionForRecord(s, ids)).toBe(s);
    }
  });

  it("the writer's prompt is built from the record-aware sections", () => {
    const src = readFileSync(join(__dirname, "..", "generate.ts"), "utf8");
    expect(src).toMatch(/!s\.exhibitOnly && sectionApplies\(s, inLedger\)\)\.map\(\(s\) => sectionForRecord\(s, inLedger\)\)/);
    expect(src).toMatch(/s\.exhibitOnly && sectionApplies\(s, inLedger\)\)\.map\(\(s\) => sectionForRecord\(s, inLedger\)\)/);
  });
});
