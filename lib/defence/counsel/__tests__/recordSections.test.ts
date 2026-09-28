import { describe, expect, it } from "vitest";
import { checkDraft } from "../checks";
import { composeDraft } from "../generate";
import { ITEM_NOT_RECEIVED } from "../playbooks";
import { buildRecordSections, pickTheory } from "../recordSections";
import { timelineBlock } from "../prompts";
import { CHECK, FILED_V12_SUMMARY, LEDGER, V12_SUMMARY } from "./fixture352543";

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
  it("reproduce the letter FILED as v12 for #352543 (package caa70bf2) word for word", () => {
    // Copied from the production narrative_json of v12, not from a draft.
    expect(text()).toEqual({
      shipping:
        "The delivery shown on the card above is the carrier's own scan, published on its public tracking page; the issuer can open it with the link below. " +
        "All three items listed under Order Line Items were in this single tracked shipment. " +
        "There was no partial or second shipment, so no part of the non-receipt claim falls outside this delivery.",
      chronology: undefined,
      conclusion:
        "The carrier recorded delivery of the entire order. After that delivery, the same customer placed a new order with the same payment method. " +
        "The non-receipt claim is not supported by the record.",
    });
  });

  it("pass every code check together with the filed v12 summary, and with a v12-shaped one", () => {
    for (const summary of [FILED_V12_SUMMARY, V12_SUMMARY]) {
      const draft = composeDraft({ paragraphs: [summary], claimIds: [] }, buildRecordSections(LEDGER));
      expect(checkDraft(draft, CHECK)).toEqual([]);
    }
  });

  it("say only what the ledger holds", () => {
    const t = text(without("later_order", "whole_order_in_shipment", "carrier_is_third_party"));
    expect(t.shipping).toBe("The delivery shown on the card above is the carrier's own scan.");
    expect(t.conclusion).toBe("The carrier recorded delivery of the order. The non-receipt claim is not supported by the record.");
    const noCard = LEDGER.map((c) => (c.id === "later_order" ? { ...c, specifics: { ...c.specifics, paidWith: "" } } : c));
    expect(text(noCard).conclusion).toContain("After that delivery, the same customer placed a new order.");
  });

  it("handle one item and a signature, and never write dispatch timing (eval, #350764: 'shipped ten days after')", () => {
    const ledger = LEDGER.map((c) =>
      c.id === "whole_order_in_shipment"
        ? { ...c, specifics: { itemCount: "1", itemCountWord: "one" } }
        : c.id === "shipped_promptly"
          ? { ...c, specifics: { shipInterval: "ten days after the order", shipDays: "10" } }
          : c,
    ).concat([{ id: "signed_for", statement: "Signed.", specifics: {}, weight: "core", sources: [], mustNot: [] }]);
    const t = text(ledger);
    expect(t.shipping).toContain(
      "The carrier also recorded a signature on delivery. The item listed under Order Line Items was in this single tracked shipment.",
    );
    expect(t.chronology).toBeUndefined();
    expect(JSON.stringify(buildRecordSections(ledger))).not.toMatch(/shipped|dispatch/i);
    expect(t.conclusion).toMatch(/^The carrier recorded delivery of the entire order, with a signature\./);
  });

  it("say 'Both items' for two (eval, Mein Maison #101259)", () => {
    const ledger = LEDGER.map((c) => (c.id === "whole_order_in_shipment" ? { ...c, specifics: { itemCount: "2", itemCountWord: "two" } } : c));
    expect(text(ledger).shipping).toContain("Both items listed under Order Line Items were in this single tracked shipment.");
    const draft = composeDraft({ paragraphs: [V12_SUMMARY], claimIds: [] }, buildRecordSections(ledger));
    expect(checkDraft(draft, { ...CHECK, ledger })).toEqual([]);
  });
});

describe("summary claims the code can refuse", () => {
  it("rejects 'the complete order' when the ledger does not prove the whole order shipped (eval, #350764)", () => {
    const ledger = without("whole_order_in_shipment");
    const draft = composeDraft({ paragraphs: [V12_SUMMARY], claimIds: [] }, buildRecordSections(ledger));
    expect(checkDraft(draft, { ...CHECK, ledger })).toEqual([
      'summary: "complete order" — the records do not show the whole order in one shipment; say "the order"',
    ]);
  });
});

describe("review timeline", () => {
  it("spells out every interval so the small reviewer does no date arithmetic", () => {
    expect(timelineBlock(LEDGER)).toBe(
      [
        "- Order placed: 2 July.",
        "- Shipped: 2 July (the same day).",
        "- Carrier recorded delivery: 6 July 2026.",
        "- Later order placed: 5 September 2026 — sixty-one days after the delivery.",
        "- Dispute opened: 19 September 2026 — fourteen days after the later order.",
      ].join("\n"),
    );
  });
});

describe("theory by code (cost refactor §3.3)", () => {
  it("is the strongest playbook theory whose claims are all in the ledger", () => {
    expect(pickTheory(LEDGER, ITEM_NOT_RECEIVED).name).toBe("delivered_and_came_back");
    expect(pickTheory(without("later_order"), ITEM_NOT_RECEIVED).name).toBe("delivered_and_notified");
    expect(pickTheory(without("later_order", "delivery_notice_same_day"), ITEM_NOT_RECEIVED).name).toBe("whole_order_one_parcel");
    expect(pickTheory(without("later_order", "delivery_notice_same_day", "whole_order_in_shipment"), ITEM_NOT_RECEIVED).name).toBe(
      "carrier_delivered",
    );
  });
});
