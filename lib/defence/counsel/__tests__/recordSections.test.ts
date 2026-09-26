import { describe, expect, it } from "vitest";
import { checkDraft } from "../checks";
import { composeDraft } from "../generate";
import { ITEM_NOT_RECEIVED } from "../playbooks";
import { buildRecordSections, pickTheory } from "../recordSections";
import { CHECK, LEDGER, V12_SUMMARY } from "./fixture352543";

const without = (...ids: string[]) => LEDGER.filter((c) => !ids.includes(c.id));
const text = (ledger = LEDGER) => {
  const r = buildRecordSections(ledger);
  return {
    shipping: r.evidenceSections.find((s) => s.key === "shipping")?.paragraphs.join(" "),
    chronology: r.evidenceSections.find((s) => s.key === "chronology")?.paragraphs.join(" "),
    conclusion: r.conclusion.paragraphs.join(" "),
  };
};

describe("code-written sections (cost refactor §3.1)", () => {
  it("reproduce the maintainer-reviewed v12 letter for #352543 word for word", () => {
    expect(text()).toEqual({
      shipping:
        "The delivery shown on the card above is the carrier's own scan, published on its public tracking page; the issuer can verify it with the link below. " +
        "All three items listed under Order Line Items were in this single tracked shipment. There was no partial or second shipment.",
      chronology:
        "The order shipped the same day it was placed, and a delivery notification went to the email address on the order the day the carrier recorded delivery.",
      conclusion:
        "The carrier recorded delivery of the entire order. After that delivery, the same customer bought again with the same payment method. The non-receipt claim is not supported by the record.",
    });
  });

  it("pass every code check together with the v12 summary", () => {
    const draft = composeDraft({ paragraphs: [V12_SUMMARY], claimIds: [] }, buildRecordSections(LEDGER));
    expect(checkDraft(draft, CHECK)).toEqual([]);
  });

  it("say only what the ledger holds", () => {
    const t = text(without("later_order", "whole_order_in_shipment", "carrier_is_third_party", "delivery_notice_same_day"));
    expect(t.shipping).toBe("The delivery shown on the card above is the carrier's own scan.");
    expect(t.chronology).toBe("The order shipped the same day it was placed.");
    expect(t.conclusion).toBe("The carrier recorded delivery of the order. The non-receipt claim is not supported by the record.");
  });

  it("handle one item, a later ship date, a signature, and no chronology", () => {
    const ledger = LEDGER.map((c) =>
      c.id === "whole_order_in_shipment"
        ? { ...c, specifics: { itemCount: "1", itemCountWord: "one" } }
        : c.id === "shipped_promptly"
          ? { ...c, specifics: { shipInterval: "two days after the order", shipDays: "2" } }
          : c,
    ).concat([{ id: "signed_for", statement: "Signed.", specifics: {}, weight: "core", sources: [], mustNot: [] }]);
    const t = text(ledger);
    expect(t.shipping).toContain("The carrier also recorded a signature on delivery. The item listed under Order Line Items was in this single tracked shipment.");
    expect(t.chronology).toBe(
      "The order shipped two days after it was placed, and a delivery notification went to the email address on the order the day the carrier recorded delivery.",
    );
    expect(t.conclusion).toMatch(/^The carrier recorded delivery of the entire order, with a signature\./);
    expect(buildRecordSections(without("shipped_promptly", "delivery_notice_same_day")).evidenceSections.map((s) => s.key)).toEqual(["shipping"]);
  });
});

describe("theory by code (cost refactor §3.3)", () => {
  it("is the strongest playbook theory whose claims are all in the ledger", () => {
    expect(pickTheory(LEDGER, ITEM_NOT_RECEIVED).name).toBe("delivered_and_came_back");
    expect(pickTheory(without("later_order"), ITEM_NOT_RECEIVED).name).toBe("delivered_and_notified");
    expect(pickTheory(without("later_order", "delivery_notice_same_day"), ITEM_NOT_RECEIVED).name).toBe("whole_order_one_parcel");
    expect(pickTheory(without("later_order", "delivery_notice_same_day", "whole_order_in_shipment"), ITEM_NOT_RECEIVED).name).toBe("carrier_delivered");
  });
});
