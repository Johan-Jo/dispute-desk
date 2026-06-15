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
