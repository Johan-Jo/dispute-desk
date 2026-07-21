import { describe, it, expect } from "vitest";
import {
  moneyFromDecimal, addMoney, scaleByBasisPoints, divRoundHalfUp,
  toDecimalString, minorUnitExponent, money, sumMoney,
} from "@/lib/intelligence/money";

describe("intelligence/money — currency-aware minor units", () => {
  it("resolves minor-unit exponent by currency (no hardcoded 2)", () => {
    expect(minorUnitExponent("USD")).toBe(2);
    expect(minorUnitExponent("JPY")).toBe(0);
    expect(minorUnitExponent("BHD")).toBe(3);
  });

  it("parses decimals to exact bigint minor units with half-up rounding", () => {
    expect(moneyFromDecimal("129.90", "USD")!.amountMinor).toBe(12990n);
    expect(moneyFromDecimal("0.005", "USD")!.amountMinor).toBe(1n); // half-up
    expect(moneyFromDecimal("0.004", "USD")!.amountMinor).toBe(0n);
    expect(moneyFromDecimal("1000", "JPY")!.amountMinor).toBe(1000n);
    expect(moneyFromDecimal("1.2345", "BHD")!.amountMinor).toBe(1235n); // 3dp, half-up
  });

  it("keeps bigint precision beyond Number.MAX_SAFE_INTEGER", () => {
    const big = moneyFromDecimal("999999999999999.99", "USD")!; // > 2^53 minor units
    expect(big.amountMinor).toBe(99999999999999999n);
    expect(toDecimalString(big)).toBe("999999999999999.99");
  });

  it("adds within a currency and refuses cross-currency", () => {
    const a = money(10000n, "USD");
    const b = money(2550n, "USD");
    expect(addMoney(a, b).amountMinor).toBe(12550n);
    expect(() => addMoney(a, money(1n, "EUR"))).toThrow(/refusing to combine/);
  });

  it("scales by INTEGER basis points (no float), rounding half-up", () => {
    // 35% of $100.00 = $35.00
    expect(scaleByBasisPoints(money(10000n, "USD"), 3500).amountMinor).toBe(3500n);
    // 33.33% of $10.00 = 333.3 → 333 (half-up on final divide)
    expect(scaleByBasisPoints(money(1000n, "USD"), 3333).amountMinor).toBe(333n);
    expect(() => scaleByBasisPoints(money(1000n, "USD"), 35.5)).toThrow(/integer/);
  });

  it("divRoundHalfUp rounds symmetrically for negatives", () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(4n, 8n)).toBe(1n); // 0.5 → up
  });

  it("sums a list within one currency", () => {
    const total = sumMoney([money(100n, "USD"), money(250n, "USD"), money(50n, "USD")], "USD");
    expect(total.amountMinor).toBe(400n);
  });
});
