import { describe, expect, it } from "vitest";
import {
  classifyAddressDeliveryClaim,
  removeAddressDeliveryClaimSentences,
} from "../claimCapabilities";
import { stripAddressDeliveryClaims } from "../stripAddressDeliveryClaims";
import type { DefenceNarrativeOutput, NarrativeSectionKey } from "../types";

const KEYS: NarrativeSectionKey[] = [
  "executiveSummary",
  "transactionOverviewArgument",
  "chronologyArgument",
  "paymentAuthenticationArgument",
  "fulfillmentArgument",
  "communicationArgument",
  "policyArgument",
  "manualEvidenceArgument",
  "conclusion",
];

function narrative(texts: Partial<Record<NarrativeSectionKey, string>>): DefenceNarrativeOutput {
  const n = { omittedSections: [], warnings: [] } as unknown as DefenceNarrativeOutput;
  for (const k of KEYS) {
    const text = texts[k] ?? "";
    (n as unknown as Record<string, unknown>)[k] = { text, usedFactIds: text ? ["f1"] : [] };
    if (!text) n.omittedSections.push({ sectionKey: k, reason: "no support" });
  }
  return n;
}

const CLAIM = "The parcel was delivered to the cardholder's shipping address on 17 July 2026.";
const CARRIER =
  "The carrier TechSHIP confirmed delivery on 17 July 2026 under tracking number 420327129261290416102423888396.";
const RETURN = "No return was initiated following delivery.";

describe("removeAddressDeliveryClaimSentences", () => {
  it("deletes only the address-claim sentence and keeps the carrier facts verbatim", () => {
    expect(classifyAddressDeliveryClaim(CLAIM)).toBe("affirmative");
    const r = removeAddressDeliveryClaimSentences(`${CARRIER} ${CLAIM} ${RETURN}`);
    expect(r.removed).toEqual([CLAIM]);
    expect(r.text).toBe(`${CARRIER} ${RETURN}`);
    expect(classifyAddressDeliveryClaim(r.text)).not.toMatch(/affirmative|ambiguous/);
  });

  it("is a no-op on prose with no address claim", () => {
    const text = `${CARRIER}\n\n${RETURN}`;
    expect(removeAddressDeliveryClaimSentences(text)).toEqual({ text, removed: [] });
  });

  it("returns empty text when the claim was the whole paragraph", () => {
    expect(removeAddressDeliveryClaimSentences(CLAIM).text).toBe("");
  });
});

describe("stripAddressDeliveryClaims", () => {
  it("returns the same object when nothing is removed", () => {
    const n = narrative({ executiveSummary: CARRIER, conclusion: RETURN });
    expect(stripAddressDeliveryClaims(n).narrative).toBe(n);
  });

  it("strips sections, headline, timeline rows and counsel summary", () => {
    const n = narrative({
      executiveSummary: `${CARRIER} ${CLAIM}`,
      fulfillmentArgument: CLAIM,
      conclusion: RETURN,
    });
    n.headline = CLAIM;
    n.timelineAdditions = [
      { at: "2026-07-17", text: CLAIM },
      { at: "2026-07-18", text: RETURN },
    ];
    n.counsel = { inputHash: "h", summary: [CLAIM, CARRIER] };

    const { narrative: out, removed } = stripAddressDeliveryClaims(n);

    expect(removed.map((r) => r.location)).toEqual([
      "executiveSummary",
      "fulfillmentArgument",
      "headline",
      "timelineAdditions",
      "counsel",
    ]);
    expect(out.executiveSummary.text).toBe(CARRIER);
    expect(out.fulfillmentArgument).toEqual({ text: "", usedFactIds: [] });
    expect(out.omittedSections.some((o) => o.sectionKey === "fulfillmentArgument")).toBe(true);
    expect(out.headline).toBeUndefined();
    expect(out.timelineAdditions).toEqual([{ at: "2026-07-18", text: RETURN }]);
    expect(out.counsel?.summary).toEqual([CARRIER]);
    expect(out.conclusion.text).toBe(RETURN);
    // The input is not mutated.
    expect(n.fulfillmentArgument.text).toBe(CLAIM);
  });
});
