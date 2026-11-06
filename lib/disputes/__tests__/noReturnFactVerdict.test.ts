/**
 * PR 0 (docs/plans/single-source-architecture-audit.plan.md §2.2).
 *
 * `noReturnFactVerdict` is the collector's "should the no-return fact exist?"
 * decision, extracted so a later PR can read the SAME answer for the checklist
 * row. These tests pin it against an INDEPENDENT statement of the pre-extraction
 * rule (the expectation is written out here, not derived from the code) over the
 * whole input grid, and pin the precedence the plan documents.
 *
 * What this cannot catch: after the extraction the collector and the verdict
 * are the same function, so agreement between them holds by construction.
 * A WRONG verdict is caught only by the hand-written cells below and by
 * `orderSourceNoReturnParity.test.ts` (the pre-extraction collector output).
 */
import { describe, expect, it } from "vitest";
import {
  noReturnFactScope,
  noReturnFactVerdict,
  returnScopeFor,
  shopifyRecordsReturnOrRefund,
  type ReturnRequestAnswer,
  type ReturnScopeInput,
} from "../returnRequestConfirmation";

const STATUSES: Array<string | null | undefined> = [
  undefined,
  null,
  "NO_RETURN",
  "RETURN_REQUESTED",
  "IN_PROGRESS",
  "RETURNED",
  "INSPECTION_COMPLETE",
  "RETURN_FAILED",
  "A_STATUS_SHOPIFY_ADDS_LATER",
  "",
];
const REFUNDS: Array<string | number | null | undefined> = [undefined, null, "", "0.00", "0.0", 0, "12.50", 12.5, "not-a-number"];
const ANSWERS: Array<ReturnRequestAnswer | null> = [null, "no_request_received", "request_received", "not_sure"];
const SCOPES: Array<ReturnScopeInput | undefined | null> = [
  undefined,
  null,
  ...[false, true].flatMap((o) => ANSWERS.map((a) => ({ returnsOutsideShopify: o, answer: a }))),
];

/** The collector's rule exactly as it was stated before the extraction. */
function legacyEmits(status: string | null | undefined, refunded: string | number | null | undefined, scope: ReturnScopeInput | null | undefined) {
  const scopeResult = noReturnFactScope({
    returnsOutsideShopify: scope?.returnsOutsideShopify === true,
    answer: scope?.answer ?? null,
  });
  return (
    status === "NO_RETURN" &&
    !shopifyRecordsReturnOrRefund({ returnStatus: status, totalRefunded: refunded }) &&
    scopeResult.emit
  );
}

/** The plan's precedence table, written independently. */
function expectedReason(status: string | null | undefined, refunded: string | number | null | undefined, scope: ReturnScopeInput | null | undefined) {
  if (status != null && status !== "NO_RETURN") return "return_on_record";
  const n = refunded == null || refunded === "" ? NaN : Number.parseFloat(String(refunded));
  if (Number.isFinite(n) && n > 0) return "refund_on_record";
  if (status == null) return "status_absent";
  if ((scope?.answer ?? null) === "request_received") return "merchant_says_request_received";
  return "emit";
}

describe("noReturnFactVerdict", () => {
  it("emits exactly when the pre-extraction collector rule emitted, over the whole grid", () => {
    let n = 0;
    for (const status of STATUSES)
      for (const refunded of REFUNDS)
        for (const scope of SCOPES) {
          const v = noReturnFactVerdict({ returnStatus: status, totalRefunded: refunded, returnScope: scope });
          const emits = "emit" in v && v.emit === true;
          expect(emits, `${status}|${refunded}|${JSON.stringify(scope)}`).toBe(legacyEmits(status, refunded, scope));
          n++;
        }
    expect(n).toBe(STATUSES.length * REFUNDS.length * SCOPES.length);
  });

  it("returns the precedence the plan documents, over the whole grid", () => {
    for (const status of STATUSES)
      for (const refunded of REFUNDS)
        for (const scope of SCOPES) {
          const v = noReturnFactVerdict({ returnStatus: status, totalRefunded: refunded, returnScope: scope });
          const got = "unknown" in v ? v.why : v.emit ? "emit" : v.reason;
          expect(got, `${status}|${refunded}|${JSON.stringify(scope)}`).toBe(expectedReason(status, refunded, scope));
        }
  });

  it("carries the fact's scope payload unchanged when it emits", () => {
    for (const scope of SCOPES) {
      const v = noReturnFactVerdict({ returnStatus: "NO_RETURN", totalRefunded: "0.00", returnScope: scope });
      if (!("emit" in v) || !v.emit) continue;
      expect(v.scope).toEqual(
        noReturnFactScope({ returnsOutsideShopify: scope?.returnsOutsideShopify === true, answer: scope?.answer ?? null }),
      );
    }
  });

  // Hand-written cells (the independent check on the verdict itself).
  it.each([
    ["#24612: return received, no refund", "RETURNED", "0.0", undefined, { emit: false, reason: "return_on_record" }],
    ["return in progress", "IN_PROGRESS", "0.00", undefined, { emit: false, reason: "return_on_record" }],
    ["a status this code does not know counts as a return on record", "BRAND_NEW", "0.00", undefined, { emit: false, reason: "return_on_record" }],
    ["NO_RETURN but money was refunded", "NO_RETURN", "50.00", undefined, { emit: false, reason: "refund_on_record" }],
    ["merchant says the customer asked", "NO_RETURN", "0.00", { returnsOutsideShopify: true, answer: "request_received" as const }, { emit: false, reason: "merchant_says_request_received" }],
    ["pre-stamp pack (status never recorded), no refund: unknown, not 'no return'", null, "0.00", undefined, { unknown: true, why: "status_absent" }],
    ["pre-stamp pack with a refund: the refund is a known fact", null, "603.57", undefined, { emit: false, reason: "refund_on_record" }],
    ["NO_RETURN with an unparseable refund total still emits (must not fail closed)", "NO_RETURN", "not-a-number", undefined, { emit: true }],
  ])("%s", (_name, status, refunded, scope, expected) => {
    const v = noReturnFactVerdict({ returnStatus: status, totalRefunded: refunded, returnScope: scope });
    if ("emit" in expected && expected.emit === true) {
      expect("emit" in v && v.emit).toBe(true);
    } else {
      expect(v).toEqual(expected);
    }
  });
});

describe("returnScopeFor", () => {
  it("is undefined (setting off) for no settings, a missing flag or false, ignoring any stored answer", () => {
    for (const settings of [null, undefined, {}, { returns_outside_shopify: false }, { returns_outside_shopify: null }]) {
      expect(returnScopeFor(settings, { answer: "request_received" })).toBeUndefined();
    }
  });

  it("carries the merchant's answer when the setting is on", () => {
    for (const answer of ["no_request_received", "request_received", "not_sure"] as const) {
      expect(returnScopeFor({ returns_outside_shopify: true }, { answer })).toEqual({ returnsOutsideShopify: true, answer });
    }
  });

  it("setting on and no answer (also what a failed answer read yields) is answer: null", () => {
    expect(returnScopeFor({ returns_outside_shopify: true }, null)).toEqual({ returnsOutsideShopify: true, answer: null });
    expect(returnScopeFor({ returns_outside_shopify: true }, undefined)).toEqual({ returnsOutsideShopify: true, answer: null });
  });

  it("reproduces the inline code it replaced for every input", () => {
    // The code in buildPack.ts before PR 0, restated.
    const legacy = (settings: { returns_outside_shopify?: boolean } | null, answer: ReturnRequestAnswer | null | "none") =>
      settings && settings.returns_outside_shopify
        ? { returnsOutsideShopify: true, answer: answer === "none" ? null : answer }
        : undefined;
    for (const settings of [null, {}, { returns_outside_shopify: false }, { returns_outside_shopify: true }])
      for (const answer of ["none", ...ANSWERS] as const)
        expect(returnScopeFor(settings, answer === "none" || answer === null ? null : { answer })).toEqual(legacy(settings, answer));
  });
});
