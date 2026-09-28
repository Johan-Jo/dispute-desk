import { describe, it, expect } from "vitest";
import { formatMoneyDisplay, humanizeEnum, reasonCodeForNetwork } from "../formatting";

describe("document formatting", () => {
  it("never prints a Shopify enum with underscores", () => {
    expect(humanizeEnum("PRODUCT_NOT_RECEIVED")).toBe("Product not received");
    expect(humanizeEnum("FRAUDULENT")).toBe("Fraudulent");
    expect(humanizeEnum(null)).toBeNull();
  });

  it("keeps only the card's own network in the reason code", () => {
    expect(reasonCodeForNetwork("Visa 13.1 / Mastercard 4855", "Visa")).toBe("Visa 13.1");
    expect(reasonCodeForNetwork("Visa 13.1 / Mastercard 4855", "Mastercard")).toBe("Mastercard 4855");
    expect(reasonCodeForNetwork("Visa 13.1 / Mastercard 4855", null)).toBe("Visa 13.1 / Mastercard 4855");
  });

  it("prints amounts with two decimals", () => {
    expect(formatMoneyDisplay("USD 129")).toBe("USD 129.00");
    expect(formatMoneyDisplay("USD 40.0")).toBe("USD 40.00");
    expect(formatMoneyDisplay("—")).toBe("—");
  });
});
