/**
 * Engine-local Money — integer minor units in `bigint`, no floating point.
 *
 * Design §1.4. The codebase has no Money value object; existing metrics sum
 * `numeric` through JS floats. The intelligence engine must not: all monetary
 * arithmetic here is exact `bigint` in the currency's minor unit. `bigint`
 * (not `number`) because DB minor-unit columns can exceed Number.MAX_SAFE_INTEGER
 * on lifetime aggregates. At JSON/DB boundaries a Money is carried as a decimal
 * string and re-parsed to bigint.
 *
 * Cross-currency addition is forbidden (mirrors lib/disputes/metrics.ts).
 * Ratio/effectiveness assumptions are INTEGER BASIS POINTS (3500 = 35%), never
 * JS floats — see scaleByBasisPoints.
 */

export const ROUNDING_RULE_VERSION = "rounding_rule_v1"; // half-up on final division

export interface Money {
  /** Exact amount in the currency's minor unit, as bigint. */
  amountMinor: bigint;
  /** ISO 4217 code, uppercased. */
  currency: string;
}

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);
const THREE_DECIMAL = new Set(["BHD", "KWD", "OMR", "TND"]);

export function minorUnitExponent(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

export function money(amountMinor: bigint, currency: string): Money {
  return { amountMinor, currency: currency.toUpperCase() };
}

export function zeroMoney(currency: string): Money {
  return { amountMinor: 0n, currency: currency.toUpperCase() };
}

/**
 * Parse a decimal amount (string, or a Postgres `numeric` returned as string)
 * into exact minor units. Applies the versioned half-up rounding rule at the
 * currency's precision so fractional cents never leak. No float step.
 */
export function moneyFromDecimal(
  amount: string | number | null | undefined,
  currency: string,
): Money | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const c = currency.toUpperCase();
  const exp = minorUnitExponent(c);
  const str = typeof amount === "number" ? amount.toString() : amount.trim();
  const neg = str.startsWith("-");
  const clean = neg ? str.slice(1) : str;
  const [intPart, fracRaw = ""] = clean.split(".");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracRaw)) return null;
  // Keep exp fractional digits + 1 guard digit for half-up rounding.
  const fracPadded = (fracRaw + "0".repeat(exp + 1)).slice(0, exp + 1);
  const keep = fracPadded.slice(0, exp);
  const guard = fracPadded.slice(exp, exp + 1) || "0";
  let minor = BigInt((intPart || "0") + keep);
  if (Number(guard) >= 5) minor += 1n;
  return { amountMinor: neg ? -minor : minor, currency: c };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`[intelligence/money] refusing to combine ${a.currency} with ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function sumMoney(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => addMoney(acc, m), zeroMoney(currency));
}

/**
 * Scale by an INTEGER basis-point factor (3500 = 35%). All-bigint: multiply
 * then a single half-up division by 10_000. No JS float ever touches a
 * monetary value, so results are exactly reproducible (ROUNDING_RULE_VERSION).
 */
export function scaleByBasisPoints(m: Money, bps: number): Money {
  if (!Number.isInteger(bps)) {
    throw new Error(`[intelligence/money] basis points must be an integer, got ${bps}`);
  }
  const b = BigInt(bps);
  const product = m.amountMinor * b;
  const scaled = divRoundHalfUp(product, 10_000n);
  return money(scaled, m.currency);
}

/** Half-up division for bigints (handles negatives symmetrically). */
export function divRoundHalfUp(numer: bigint, denom: bigint): bigint {
  if (denom === 0n) throw new Error("[intelligence/money] division by zero");
  const neg = (numer < 0n) !== (denom < 0n);
  const a = numer < 0n ? -numer : numer;
  const d = denom < 0n ? -denom : denom;
  const q = a / d;
  const r = a % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return neg ? -rounded : rounded;
}

/** Annualize a historical-total amount over an observed span of days. */
export function annualizeMoney(m: Money, spanDays: number): Money {
  if (spanDays <= 0) return zeroMoney(m.currency);
  // 365/spanDays expressed exactly via bigint: amount * 365 / spanDays.
  return money(divRoundHalfUp(m.amountMinor * 365n, BigInt(Math.trunc(spanDays))), m.currency);
}

export function toDecimalString(m: Money): string {
  const exp = minorUnitExponent(m.currency);
  const neg = m.amountMinor < 0n;
  const abs = (neg ? -m.amountMinor : m.amountMinor).toString().padStart(exp + 1, "0");
  if (exp === 0) return (neg ? "-" : "") + abs;
  const intPart = abs.slice(0, abs.length - exp);
  const fracPart = abs.slice(abs.length - exp);
  return `${neg ? "-" : ""}${intPart}.${fracPart}`;
}

/** Human-readable, admin-only (no i18n on the internal surface). */
export function formatMoney(m: Money | null): string {
  if (!m) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: m.currency,
      maximumFractionDigits: minorUnitExponent(m.currency),
    }).format(Number(toDecimalString(m)));
  } catch {
    return `${m.currency} ${toDecimalString(m)}`;
  }
}

/** JSON boundary: minor units as a decimal STRING (never a JS number). */
export function moneyToJSON(m: Money | null): { amountMinor: string; currency: string } | null {
  return m ? { amountMinor: m.amountMinor.toString(), currency: m.currency } : null;
}

export function moneyFromJSON(v: { amountMinor: string; currency: string } | null): Money | null {
  return v ? money(BigInt(v.amountMinor), v.currency) : null;
}
