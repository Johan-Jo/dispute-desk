/**
 * Coverage source — Shopify Protect gating.
 */

import { describe, expect, it } from "vitest";
import {
  collectCoverageEvidence,
  summarizeCoverage,
} from "../coverageSource";
import type { BuildContext } from "../../types";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

type ProtectStatus = "ACTIVE" | "INACTIVE" | "NOT_PROTECTED" | "PENDING" | "PROTECTED";

function ctxWithProtect(status: ProtectStatus | null): BuildContext {
  const order = {
    shopifyProtect: status === null ? null : { status },
    transactions: [],
  } as unknown as OrderDetailNode;
  return {
    packId: "p1",
    disputeId: "d1",
    shopId: "s1",
    disputeReason: "fraudulent",
    orderGid: "gid://shopify/Order/1",
    shopDomain: "test.myshopify.com",
    accessToken: "x",
    order,
  };
}

describe("summarizeCoverage", () => {
  it("PROTECTED → covered_shopify (chargeback already covered)", () => {
    const ctx = ctxWithProtect("PROTECTED");
    const s = summarizeCoverage(ctx.order);
    expect(s.state).toBe("covered_shopify");
    expect(s.isCovered).toBe(true);
    expect(s.shopifyProtectStatus).toBe("PROTECTED");
  });

  it("ACTIVE → covered_shopify (eligible & live)", () => {
    const s = summarizeCoverage(ctxWithProtect("ACTIVE").order);
    expect(s.state).toBe("covered_shopify");
    expect(s.isCovered).toBe(true);
  });

  it("PENDING → not_covered (not yet decided)", () => {
    const s = summarizeCoverage(ctxWithProtect("PENDING").order);
    expect(s.state).toBe("not_covered");
    expect(s.isCovered).toBe(false);
  });

  it("INACTIVE → not_covered", () => {
    const s = summarizeCoverage(ctxWithProtect("INACTIVE").order);
    expect(s.state).toBe("not_covered");
  });

  it("NOT_PROTECTED → not_covered (chargeback received without coverage)", () => {
    const s = summarizeCoverage(ctxWithProtect("NOT_PROTECTED").order);
    expect(s.state).toBe("not_covered");
  });

  it("null shopifyProtect → not_covered, status null", () => {
    const s = summarizeCoverage(ctxWithProtect(null).order);
    expect(s.state).toBe("not_covered");
    expect(s.shopifyProtectStatus).toBe(null);
  });

  it("null order → not_covered, status null", () => {
    const s = summarizeCoverage(null);
    expect(s.state).toBe("not_covered");
    expect(s.shopifyProtectStatus).toBe(null);
  });
});

describe("collectCoverageEvidence", () => {
  it("emits a section when Protect status is set (PROTECTED)", async () => {
    const sections = await collectCoverageEvidence(ctxWithProtect("PROTECTED"));
    expect(sections).toHaveLength(1);
    expect(sections[0].fieldsProvided).toEqual(["shopify_protect_coverage"]);
    expect(sections[0].data.state).toBe("covered_shopify");
    expect(sections[0].data.isCovered).toBe(true);
  });

  it("emits a section even when Protect is INACTIVE (audit signal)", async () => {
    const sections = await collectCoverageEvidence(ctxWithProtect("INACTIVE"));
    expect(sections).toHaveLength(1);
    expect(sections[0].data.isCovered).toBe(false);
  });

  it("does NOT emit when shopifyProtect is null (program not applicable)", async () => {
    const sections = await collectCoverageEvidence(ctxWithProtect(null));
    expect(sections).toEqual([]);
  });

  it("does NOT emit when ctx.order is null", async () => {
    const ctx: BuildContext = {
      packId: "p",
      disputeId: "d",
      shopId: "s",
      disputeReason: null,
      orderGid: null,
      shopDomain: "x",
      accessToken: "y",
      order: null,
    };
    expect(await collectCoverageEvidence(ctx)).toEqual([]);
  });
});
