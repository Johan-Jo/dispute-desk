/**
 * The in-app document mirror takes its frame from the same `disputeFrame`
 * the PDF uses (Mein Maison #102083, 2026-09-29: a PayPal dispute's HTML view
 * printed "Chargeback response" and "Card network —" while the PDF said
 * "Dispute response" and "Payment method: PayPal").
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCaseDetailsRows } from "../render/caseDetails";
import { disputeFrame, responseTitle } from "../counsel/frame";

const src = readFileSync(
  resolve(process.cwd(), "app/(embedded)/app/disputes/[id]/tabs/sections/DefencePackageHtmlView.tsx"),
  "utf8",
);

describe("HTML view dispute frame", () => {
  it("never hardcodes the response title", () => {
    expect(src).not.toMatch(/>Chargeback response</);
    expect(src).toMatch(/responseTitle\(frame\)/);
  });

  it("passes the provider to Case Details", () => {
    expect(src).toMatch(/paymentMethodLabel:\s*frame\.provider === "card" \? null : frame\.providerName/);
  });

  it("a PayPal dispute reads as a dispute with a payment method, not a card network", () => {
    const frame = disputeFrame({ paymentFamily: "paypal", phase: "inquiry" });
    expect(responseTitle(frame)).toBe("Dispute response");
    const rows = buildCaseDetailsRows({ paymentMethodLabel: frame.providerName, cardNetwork: null });
    expect(rows.find(([l]) => l === "Payment method")?.[1]).toBe("PayPal");
    expect(rows.some(([l]) => l === "Card network")).toBe(false);
  });
});
