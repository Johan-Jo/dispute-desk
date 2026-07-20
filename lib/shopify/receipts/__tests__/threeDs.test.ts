/**
 * Pins the canonical 3DS receipt walk against the receipt shapes
 * observed LIVE on real Shopify Payments orders (probe:
 * scripts/probe-3ds-cay-receipts.mjs, cay prod, 2026-07-19).
 *
 * These fixtures are contract evidence, not synthetic examples — the
 * two positive shapes were each missed by the pre-2026-07 walk and
 * produced a store-wide false-zero. Do not "simplify" them.
 */
import { describe, expect, it } from "vitest";
import {
  parseReceiptJson,
  readThreeDsAuthenticated,
} from "../threeDs";

/** Shape 1 — old PaymentIntent era: charge under charges.data[0],
 *  block carries the `authenticated` boolean. Verbatim from cay order
 *  #1014 (field subset). */
const OLD_CHARGES_SHAPE = {
  id: "pi_old",
  object: "payment_intent",
  charges: {
    data: [
      {
        payment_method_details: {
          card: {
            brand: "mastercard",
            three_d_secure: {
              authenticated: true,
              authentication_flow: "challenge",
              result: "authenticated",
              result_reason: null,
              succeeded: true,
              version: "2.2.0",
            },
          },
          type: "card",
        },
      },
    ],
  },
};

/** Shape 2 — modern PaymentIntent: latest_charge nesting, NO
 *  `authenticated` boolean — success only via result. Verbatim from cay
 *  order #13812 (field subset). */
const MODERN_RESULT_ONLY_SHAPE = {
  id: "pi_modern",
  object: "payment_intent",
  latest_charge: {
    payment_method_details: {
      card: {
        brand: "visa",
        three_d_secure: {
          authentication_flow: "challenge",
          electronic_commerce_indicator: "02",
          exemption_indicator: null,
          result: "authenticated",
          result_reason: null,
          transaction_id: "72e97d37-cf4d-421d-9ed9-afcea6a55f82",
          version: "2.2.0",
        },
      },
    },
  },
};

/** Shape 3 — documented legacy fallback: pmd at receipt root. */
const ROOT_LEGACY_SHAPE = {
  payment_method_details: {
    card: { three_d_secure: { authenticated: true } },
  },
};

function modernWithTds(tds: unknown) {
  return {
    latest_charge: { payment_method_details: { card: { three_d_secure: tds } } },
  };
}

describe("readThreeDsAuthenticated — positive shapes (live-pinned)", () => {
  it("shape 1: old charges.data[0] nesting with authenticated:true", () => {
    expect(readThreeDsAuthenticated(OLD_CHARGES_SHAPE)).toBe(true);
  });

  it("shape 2: modern latest_charge with result:'authenticated' and NO authenticated field", () => {
    expect(readThreeDsAuthenticated(MODERN_RESULT_ONLY_SHAPE)).toBe(true);
  });

  it("shape 3: root-level legacy fallback with authenticated:true", () => {
    expect(readThreeDsAuthenticated(ROOT_LEGACY_SHAPE)).toBe(true);
  });

  it("old shape also accepted via its result field alone", () => {
    const receipt = {
      charges: {
        data: [
          {
            payment_method_details: {
              card: { three_d_secure: { result: "authenticated" } },
            },
          },
        ],
      },
    };
    expect(readThreeDsAuthenticated(receipt)).toBe(true);
  });
});

describe("readThreeDsAuthenticated — everything else collapses to null", () => {
  it("three_d_secure: null (3DS not used — the common case)", () => {
    expect(readThreeDsAuthenticated(modernWithTds(null))).toBeNull();
  });

  it("result:'exempted' (SCA exemption is not an authentication)", () => {
    expect(
      readThreeDsAuthenticated(
        modernWithTds({ result: "exempted", exemption_indicator: "tra" }),
      ),
    ).toBeNull();
  });

  it("result:'attempt_acknowledged' is not a positive", () => {
    expect(
      readThreeDsAuthenticated(modernWithTds({ result: "attempt_acknowledged" })),
    ).toBeNull();
  });

  it("authenticated:false is null, never false (absence is not negative)", () => {
    expect(
      readThreeDsAuthenticated(
        modernWithTds({ authenticated: false, result: "failed" }),
      ),
    ).toBeNull();
  });

  it("non-boolean authenticated / non-string result are rejected", () => {
    expect(
      readThreeDsAuthenticated(modernWithTds({ authenticated: "yes" })),
    ).toBeNull();
    expect(
      readThreeDsAuthenticated(modernWithTds({ result: ["authenticated"] })),
    ).toBeNull();
  });

  it("missing block / wrong node types at every level", () => {
    expect(readThreeDsAuthenticated({})).toBeNull();
    expect(readThreeDsAuthenticated({ latest_charge: "str" })).toBeNull();
    expect(
      readThreeDsAuthenticated({ latest_charge: { payment_method_details: { card: [] } } }),
    ).toBeNull();
    expect(
      readThreeDsAuthenticated({ charges: { data: "not-an-array" } }),
    ).toBeNull();
    expect(readThreeDsAuthenticated({ charges: { data: [] } })).toBeNull();
  });
});

describe("parseReceiptJson", () => {
  it("parses a stringified receipt (the 2026-01 live form)", () => {
    const parsed = parseReceiptJson(JSON.stringify(MODERN_RESULT_ONLY_SHAPE));
    expect(parsed).not.toBeNull();
    expect(readThreeDsAuthenticated(parsed!)).toBe(true);
  });

  it("accepts a pre-parsed object", () => {
    expect(parseReceiptJson(OLD_CHARGES_SHAPE)).toBe(OLD_CHARGES_SHAPE);
  });

  it("rejects null, malformed strings, arrays, and scalars", () => {
    expect(parseReceiptJson(null)).toBeNull();
    expect(parseReceiptJson("{not-json")).toBeNull();
    expect(parseReceiptJson('"a string"')).toBeNull();
    expect(parseReceiptJson([1, 2])).toBeNull();
    expect(parseReceiptJson(42)).toBeNull();
  });
});
