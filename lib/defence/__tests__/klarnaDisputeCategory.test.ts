import { describe, it, expect } from "vitest";
import { klarnaDisputeCategoryDisplay } from "@/lib/defence/klarnaDisputeCategory";

describe("klarnaDisputeCategoryDisplay", () => {
  it("maps PRODUCT_NOT_RECEIVED to Goods not received", () => {
    expect(klarnaDisputeCategoryDisplay("PRODUCT_NOT_RECEIVED")).toBe(
      "Klarna dispute — Goods not received",
    );
  });

  it("maps CREDIT_NOT_PROCESSED to Refund not processed", () => {
    expect(klarnaDisputeCategoryDisplay("CREDIT_NOT_PROCESSED")).toBe(
      "Klarna dispute — Refund not processed",
    );
  });

  it("maps FRAUDULENT to Unauthorized purchase", () => {
    expect(klarnaDisputeCategoryDisplay("FRAUDULENT")).toBe(
      "Klarna dispute — Unauthorized purchase",
    );
  });

  it("is case-insensitive on the reason enum", () => {
    expect(klarnaDisputeCategoryDisplay("product_not_received")).toBe(
      "Klarna dispute — Goods not received",
    );
  });

  it("NEVER returns a Visa/Mastercard code for any input", () => {
    for (const r of [
      "PRODUCT_NOT_RECEIVED",
      "CREDIT_NOT_PROCESSED",
      "PRODUCT_UNACCEPTABLE",
      "FRAUDULENT",
      "SOMETHING_UNKNOWN",
      null,
      "",
    ]) {
      const out = klarnaDisputeCategoryDisplay(r as string);
      expect(out).not.toMatch(/visa/i);
      expect(out).not.toMatch(/mastercard/i);
      expect(out).not.toMatch(/\d+\.\d+/); // no "13.1" style codes
      expect(out.startsWith("Klarna dispute")).toBe(true);
    }
  });

  it("falls back to bare 'Klarna dispute' for unknown/absent reason", () => {
    expect(klarnaDisputeCategoryDisplay(null)).toBe("Klarna dispute");
    expect(klarnaDisputeCategoryDisplay("WAT")).toBe("Klarna dispute");
  });
});

describe("nonCardDisputeCategoryDisplay", async () => {
  const { nonCardDisputeCategoryDisplay } = await import("@/lib/defence/klarnaDisputeCategory");

  it("names a PayPal dispute after PayPal, never Klarna (Mein Maison #101111)", () => {
    const label = nonCardDisputeCategoryDisplay("paypal", "PayPal", "PRODUCT_UNACCEPTABLE");
    expect(label).toBe("PayPal dispute — Not as described");
    expect(label).not.toMatch(/klarna/i);
  });

  it("keeps Klarna's own taxonomy for Klarna", () => {
    expect(nonCardDisputeCategoryDisplay("klarna", "Klarna", "PRODUCT_UNACCEPTABLE")).toBe(
      "Klarna dispute — Faulty or not as described",
    );
  });

  it("falls back to a neutral provider name and never a card network code", () => {
    expect(nonCardDisputeCategoryDisplay("affirm", null, "PRODUCT_NOT_RECEIVED")).toBe(
      "Payment provider dispute — Item not received",
    );
    for (const r of ["PRODUCT_NOT_RECEIVED", "FRAUDULENT", "GENERAL", null]) {
      expect(nonCardDisputeCategoryDisplay("paypal", "PayPal", r)).not.toMatch(/visa|mastercard|klarna/i);
    }
  });
});
