import { describe, expect, it, afterEach } from "vitest";
import { parseScopes, getRequiredScopes, findMissingScopes } from "../scopes";

describe("parseScopes", () => {
  it("splits, trims, de-dupes, drops empties", () => {
    expect(parseScopes(" a, b ,b, ,c ")).toEqual(["a", "b", "c"]);
  });
  it("returns [] for null/empty", () => {
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes("")).toEqual([]);
  });
});

describe("findMissingScopes", () => {
  it("returns scopes required but not granted", () => {
    const missing = findMissingScopes("read_orders,read_products", [
      "read_orders",
      "read_legal_policies",
    ]);
    expect(missing).toEqual(["read_legal_policies"]);
  });

  it("returns [] when grant covers everything required", () => {
    expect(
      findMissingScopes("read_orders,read_legal_policies,write_pixels", [
        "read_orders",
        "read_legal_policies",
      ]),
    ).toEqual([]);
  });

  it("ignores grant ordering / whitespace", () => {
    expect(
      findMissingScopes("  read_legal_policies , read_orders ", [
        "read_orders",
        "read_legal_policies",
      ]),
    ).toEqual([]);
  });

  it("fails open when no required scopes resolved (misconfigured env)", () => {
    expect(findMissingScopes("read_orders", [])).toEqual([]);
  });

  it("treats a missing grant as all-required-missing", () => {
    expect(findMissingScopes(null, ["read_orders"])).toEqual(["read_orders"]);
  });

  it("a granted write_X satisfies a required read_X (Shopify write-implies-read)", () => {
    // Regression for the prod 2026-06-15 infinite approve loop: SHOPIFY_SCOPES
    // requested read_shopify_payments_dispute_{evidences,file_uploads} but
    // Shopify granted the write_ siblings only. Strict containment looped.
    const granted =
      "read_legal_policies,write_shopify_payments_dispute_evidences,write_shopify_payments_dispute_file_uploads";
    const required = [
      "read_legal_policies",
      "read_shopify_payments_dispute_evidences",
      "read_shopify_payments_dispute_file_uploads",
    ];
    expect(findMissingScopes(granted, required)).toEqual([]);
  });

  it("read_X does NOT satisfy a required write_X (no reverse implication)", () => {
    expect(findMissingScopes("read_orders", ["write_orders"])).toEqual([
      "write_orders",
    ]);
  });
});

describe("getRequiredScopes", () => {
  const prev = process.env.SHOPIFY_SCOPES;
  afterEach(() => {
    process.env.SHOPIFY_SCOPES = prev;
  });
  it("reads and parses SHOPIFY_SCOPES", () => {
    process.env.SHOPIFY_SCOPES = "read_orders, read_legal_policies";
    expect(getRequiredScopes()).toEqual(["read_orders", "read_legal_policies"]);
  });
});
