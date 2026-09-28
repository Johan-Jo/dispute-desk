/**
 * Not-as-described counsel letters and the dispute frame
 * (docs/plans/defence-letter-structure.plan.md §4–§5). Fixture: Mein Maison
 * #101111 (2026-09-28), a PayPal inquiry whose template letter led with German
 * product specs and dropped shipping, delivery and the dispute's opening.
 */
import { describe, expect, it } from "vitest";
import { buildNotAsDescribedLedger } from "../notAsDescribedLedger";
import { addDisputeOpenedRow } from "../run";
import { disputeFrame, requestLine, requestPattern, responseTitle, wrongFrameWords } from "../frame";
import { buildRecordSections } from "../recordSections";
import { checkDraft, englishOnlyIssues } from "../checks";
import { NOT_AS_DESCRIBED, playbookForModule } from "../playbooks";
import { buildCaseDetailsRows } from "../../render/caseDetails";
import { translationIssues } from "../../listingTranslation";
import { deriveInternalNarrativeConstraints } from "@/lib/integrations/gorgias/internalNarrativeConstraints";
import type { LedgerInput } from "../types";

const TITLE = "Saug- und Wischroboter MobiSweep | 3-in-1 Funktion | Selbstaufladend & Flüsterleise | Kompakt 25×25×6,5 cm";

function input(over: Partial<LedgerInput> = {}): LedgerInput {
  return {
    moduleKey: "product_unacceptable",
    facts: [],
    orderName: "#101111",
    disputeOpenedAt: "2026-09-26T14:40:38Z",
    disputeAmount: 85.46,
    disputeCurrency: "EUR",
    customerOrders: [],
    packSections: [
      { type: "order", source: "shopify_order", data: { orderName: "#101111", createdAt: "2026-09-06T10:36:58Z", lineItems: [{ title: TITLE }] } },
      { type: "order", source: "shopify_order", data: { returnStatus: "NO_RETURN" } },
      {
        type: "shipping",
        source: "shopify_fulfillments",
        data: {
          fulfillments: [
            { createdAt: "2026-09-07T06:07:54Z", deliveredAt: "2026-09-18T09:29:08Z", shipmentProofType: "delivered_confirmed", tracking: [{ number: "YT1", carrier: "YunExpress" }] },
          ],
        },
      },
      { type: "access_log", source: "shopify_order", data: { timelineEvents: [{ createdAt: "2026-09-06T10:36:58Z", message: "Angela placed this order on Online Store." }] } },
      {
        type: "other",
        source: "shopify_product",
        data: { listings: [{ snapshotId: "s1", title: TITLE, excerpt: "Sauberkeit auf Knopfdruck …", fetchedAt: "2026-09-28T14:40:00Z", imagePaths: ["a.jpg"] }] },
      },
    ],
    ...over,
  };
}

describe("not-as-described ledger (#101111)", () => {
  it("carries the listing and the full sequence: shipped, delivered, dispute opened, no return", () => {
    const ids = buildNotAsDescribedLedger(input())!.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(["claim_is_not_as_described", "listing_published", "shipped", "carrier_delivered", "dispute_after_delivery", "no_return_recorded"]),
    );
    const gap = buildNotAsDescribedLedger(input())!.find((c) => c.id === "dispute_after_delivery")!;
    expect(gap.specifics.daysAfterDeliveryWord).toBe("eight");
  });

  it("withholds the return line when a stored message asks to return the goods", () => {
    const constraints = deriveInternalNarrativeConstraints([
      { id: "m1", senderType: "customer", sentAt: "2026-09-20T00:00:00Z", messageText: "Ich möchte den Roboter zurückschicken", evidenceCategory: null, ticketMatchStatus: "confirmed_match", ticketConfidence: "high" },
    ]);
    expect(constraints.returnRequested).toBe(true);
    const ids = buildNotAsDescribedLedger(input(), { constraints })!.map((c) => c.id);
    expect(ids).not.toContain("no_return_recorded");
  });

  it("never states conformity: every claim forbids it, and the code-written text passes the family's bans", () => {
    const ledger = buildNotAsDescribedLedger(input())!;
    const record = buildRecordSections(ledger, NOT_AS_DESCRIBED);
    const text = [...record.evidenceSections.flatMap((s) => s.paragraphs), ...record.conclusion.paragraphs].join(" ");
    expect(text).not.toMatch(/\bas (?:described|advertised|listed)\b|\bmatch|\bconform|at the time of purchase/i);
    expect(text).toContain("No return has been recorded in Shopify for this order.");
  });
});

describe("the dispute frame", () => {
  const paypalInquiry = disputeFrame({ paymentFamily: "paypal", phase: "inquiry" });

  it("names a PayPal dispute as PayPal's, never a chargeback", () => {
    expect(responseTitle(paypalInquiry)).toBe("Dispute response");
    expect(requestLine(paypalInquiry)).toBe("The merchant respectfully requests that PayPal close this dispute in the merchant's favour.");
    expect(requestPattern(paypalInquiry).test(requestLine(paypalInquiry))).toBe(true);
    expect(wrongFrameWords(paypalInquiry)!.test("reversal of the chargeback")).toBe(true);
  });

  it("keeps a card chargeback exactly as before", () => {
    const card = disputeFrame({ paymentFamily: "card", phase: "chargeback" });
    expect(requestLine(card)).toBe("The merchant respectfully requests reversal of the chargeback.");
    expect(wrongFrameWords(card)).toBeNull();
  });

  it("adds a 'dispute opened' row when Shopify's events carry none", () => {
    const ledger = buildNotAsDescribedLedger(input())!;
    addDisputeOpenedRow(ledger, input().packSections, "2026-09-26T14:40:38Z", paypalInquiry);
    expect(ledger.find((c) => c.id === "dispute_after_delivery")!.timelineEvent).toEqual({
      at: "2026-09-26T14:40:38Z",
      text: "The customer opened a PayPal dispute.",
    });
  });

  it("prints no card rows for a PayPal dispute", () => {
    const rows = buildCaseDetailsRows({ paymentMethodLabel: "PayPal", cardholderName: "Angela", cardNetwork: null, cardLast4: null });
    const labels = rows.map(([l]) => l);
    expect(labels).toContain("Payment method");
    expect(labels).toContain("Customer name");
    expect(labels).not.toContain("Card network");
    expect(labels).not.toContain("Card (last 4)");
  });
});

describe("English only (maintainer, 2026-09-28)", () => {
  it("flags the store title, German letters and German words in model text", () => {
    expect(englishOnlyIssues("The buyer ordered the MobiSweep Saug- und Wischroboter.", [TITLE]).length).toBeGreaterThan(0);
    expect(englishOnlyIssues("The variant Weiß was ordered.").join(" ")).toMatch(/non-English characters/);
    expect(englishOnlyIssues("The item und the order.").join(" ")).toMatch(/non-English word/);
    expect(englishOnlyIssues("The customer says the item was not as described.")).toEqual([]);
  });

  it("allows the merchant's and customer's own names", () => {
    expect(englishOnlyIssues("Angela Parczany ordered from Mein Maison.", [], ["Angela Parczany"])).toEqual([]);
  });

  it("a translation that loses a number is not printed", () => {
    const original = { title: "Kompakt 25×25×6,5 cm", variantLine: null, excerpt: null };
    expect(translationIssues(original, { title: "Compact 25×25×6.5 cm", variantLine: null, excerpt: null })).toEqual([]);
    expect(translationIssues(original, { title: "Compact 25×25 cm", variantLine: null, excerpt: null }).length).toBeGreaterThan(0);
  });
});

describe("the not-as-described summary checks", () => {
  const ledger = buildNotAsDescribedLedger(input())!;
  const record = buildRecordSections(ledger, NOT_AS_DESCRIBED);
  const frame = disputeFrame({ paymentFamily: "paypal", phase: "inquiry" });
  const ctx = {
    ledger,
    playbook: NOT_AS_DESCRIBED,
    facts: [],
    disputeOpenedAt: "2026-09-26T14:40:38Z",
    merchantName: "Mein Maison",
    carrierName: "YunExpress",
    pageIdentifiers: ["#101111", "101111"],
    trackingUrl: null,
    frame,
    forbiddenTitles: [TITLE],
  };
  const draft = (summary: string) => ({ summary: { paragraphs: [summary], claimIds: [] }, evidenceSections: record.evidenceSections, conclusion: record.conclusion });

  it("routes product_unacceptable to the not-as-described playbook", () => {
    expect(playbookForModule("product_unacceptable")).toBe(NOT_AS_DESCRIBED);
  });

  it("refuses a summary that mentions returns, says chargeback, or uses the store title", () => {
    const issues = checkDraft(
      draft("The cardholder says the Saug- und Wischroboter MobiSweep was not as described. No return was made. The merchant respectfully requests reversal of the chargeback."),
      ctx,
    ).join("\n");
    expect(issues).toMatch(/returns are written by code/);
    expect(issues).toMatch(/misnames this proceeding/);
    expect(issues).toMatch(/store title/);
  });
});
