import { describe, expect, it } from "vitest";
import { buildItemNotReceivedLedger } from "../claimLedger";
import { toNarrative } from "../checks";
import { addressCard } from "../../render/documentModel";
import type { EvidenceFact } from "../../types";
import type { LedgerInput } from "../types";

const HOME = { address1: "12 Elm Street", address2: null, city: "Carman", province: "Manitoba", provinceCode: "MB", zip: "R0G 0J0", country: "Canada", countryCode: "CA" };

function input(opts: { shipping?: object | null; billing?: object | null; avs?: string | null; cardCompany?: string }): LedgerInput {
  const facts = [
    {
      id: "f1",
      category: "delivery_proof",
      value: { proofType: "delivered_confirmed", carrier: "Northwind Post", trackingNumber: "T1", deliveredAt: "2026-03-09T12:00:00Z" },
    },
  ] as unknown as EvidenceFact[];
  return {
    moduleKey: "inr_product_not_received",
    facts,
    packSections: [
      { type: "order", data: { orderName: "#1", createdAt: "2026-03-03T10:00:00Z", shippingAddressFull: opts.shipping ?? null, billingAddressFull: opts.billing ?? null } },
      { type: "other", data: { avsResultCode: opts.avs ?? null, cardCompany: opts.cardCompany ?? "Visa" } },
    ],
    orderName: "#1",
    disputeOpenedAt: "2026-04-21T00:00:00Z",
    disputeAmount: null,
    disputeCurrency: null,
    customerOrders: [],
  };
}
const ids = (i: LedgerInput) => buildItemNotReceivedLedger(i)!.map((c) => c.id);

describe("address claims (counsel ledger)", () => {
  it("claims and shows the addresses when shipping and billing are identical", () => {
    const ledger = buildItemNotReceivedLedger(input({ shipping: HOME, billing: { ...HOME, zip: "r0g0j0" } }))!;
    const claim = ledger.find((c) => c.id === "shipping_matches_billing");
    expect(claim).toBeTruthy();
    expect(claim!.addressExhibit!.shipping).toEqual(["12 Elm Street", "Carman, MB R0G 0J0", "Canada"]);
    const n = toNarrative({ summary: { paragraphs: ["x"], claimIds: [] }, evidenceSections: [], conclusion: { paragraphs: [], claimIds: [] } }, [], null, ledger);
    expect(n.addressExhibit).toEqual(claim!.addressExhibit);
    expect(addressCard(n.addressExhibit)!.fields.map((f) => f.label)).toEqual(["Shipping address", "Billing address"]);
  });

  it("says and shows nothing when the street differs (case #352543)", () => {
    const ledger = buildItemNotReceivedLedger(input({ shipping: HOME, billing: { ...HOME, address1: "40 Main Road" } }))!;
    expect(ledger.map((c) => c.id)).not.toContain("shipping_matches_billing");
    const n = toNarrative({ summary: { paragraphs: ["x"], claimIds: [] }, evidenceSections: [], conclusion: { paragraphs: [], claimIds: [] } }, [], null, ledger);
    expect(n.addressExhibit).toBeUndefined();
  });

  it("says nothing when a unit is on one address only, or an address is missing", () => {
    expect(ids(input({ shipping: { ...HOME, address2: "Unit 5" }, billing: HOME }))).not.toContain("shipping_matches_billing");
    expect(ids(input({ shipping: HOME, billing: null }))).not.toContain("shipping_matches_billing");
    expect(ids(input({ shipping: { ...HOME, address1: null }, billing: { ...HOME, address1: null } }))).not.toContain("shipping_matches_billing");
  });

  it("adds the issuer's address check only on a citable Visa Y/M and only with the match", () => {
    expect(ids(input({ shipping: HOME, billing: HOME, avs: "Y" }))).toContain("billing_address_verified");
    expect(ids(input({ shipping: HOME, billing: HOME, avs: "U" }))).not.toContain("billing_address_verified");
    expect(ids(input({ shipping: HOME, billing: HOME, avs: "Y", cardCompany: "Mastercard" }))).not.toContain("billing_address_verified");
    expect(ids(input({ shipping: HOME, billing: { ...HOME, address1: "40 Main Road" }, avs: "Y" }))).not.toContain("billing_address_verified");
    const ledger = buildItemNotReceivedLedger(input({ shipping: HOME, billing: HOME, avs: "Y" }))!;
    expect(ledger.find((c) => c.addressExhibit)!.addressExhibit!.avs).toEqual({ code: "Y", network: "visa" });
  });

  it("states the match on the card, not in prose", () => {
    const ledger = buildItemNotReceivedLedger(input({ shipping: HOME, billing: HOME }))!;
    const card = addressCard(ledger.find((c) => c.addressExhibit)!.addressExhibit)!;
    expect(card.product).toBe("The shipping address entered at checkout is identical to the billing address.");
  });
});
