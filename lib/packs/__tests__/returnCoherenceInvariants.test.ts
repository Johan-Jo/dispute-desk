/**
 * PR 1 invariants (plan §2.1.5 and the bank-facing boundary).
 *
 * The read-time assembler may change what a merchant SEES. It must change
 * nothing that is stored, scored, filed or hashed. The build-time parity suite
 * (`completenessModeParity.test.ts`, `orderSourceNoReturnParity.test.ts`) pins
 * the build output byte-for-byte; this file pins the seams PR 1 added.
 */
import { describe, expect, it, vi } from "vitest";
import {
  evaluateCompletenessV2,
  fieldApplicability,
  inapplicableFields,
  resolveItemStatus,
  type OrderContext,
} from "@/lib/automation/completeness";
import {
  canMerchantUpload,
  canMerchantUploadAtBuild,
} from "@/lib/disputes/presentation/concreteContribution";
import { loadReturnScopeForPack } from "../loadReturnScope";

const baseCtx: OrderContext = { isFulfilled: true, hasCardPayment: true, avsCvvAvailable: true };

describe("build time is untouched while noReturnFact is unset", () => {
  it("fieldApplicability is applicable for every field", () => {
    expect(fieldApplicability("no_return_initiated", baseCtx)).toEqual({ applicable: true });
    expect([...inapplicableFields(baseCtx)]).toEqual([]);
  });

  it("a missing no_return_initiated row is still `missing` at build time", () => {
    expect(resolveItemStatus("recommended", baseCtx, false, undefined, "no_return_initiated").status).toBe("missing");
  });

  it("the same row is `unavailable` with a CODE reason once the read-time context sets the fact", () => {
    const ctx: OrderContext = { ...baseCtx, noReturnFact: { applicable: false, reason: "return_on_record" } };
    const r = resolveItemStatus("recommended", ctx, false, undefined, "no_return_initiated");
    expect(r).toEqual({ status: "unavailable", collectable: false, unavailableReason: "return_on_record" });
    expect(/\s/.test(r.unavailableReason ?? "")).toBe(false); // a code, never English
  });

  it("an available or waived row is never turned unavailable by the field half", () => {
    const ctx: OrderContext = { ...baseCtx, noReturnFact: { applicable: false, reason: "return_on_record" } };
    expect(resolveItemStatus("recommended", ctx, true, undefined, "no_return_initiated").status).toBe("available");
  });

  it("evaluateCompletenessV2 without the fact keeps the row (score, readiness, recommended_actions come from the stored build rule)", () => {
    const out = evaluateCompletenessV2("CREDIT_NOT_PROCESSED", new Set(), null, null, baseCtx);
    expect(out.checklist.some((c) => c.field === "no_return_initiated")).toBe(true);
  });
});

describe("the upload rule: display closed, persisted recommended_actions unchanged", () => {
  it.each(["refund_record", "no_return_initiated"])("%s is not merchant-uploadable on any display surface", (f) => {
    for (const collectionType of ["manual", "conditional_auto", "auto", undefined]) {
      expect(canMerchantUpload({ field: f, collectionType })).toBe(false);
    }
  });

  it.each(["refund_record", "no_return_initiated"])(
    "%s keeps the pre-PR1 rule at build time, so stored recommended_actions are byte-identical",
    (f) => {
      expect(canMerchantUploadAtBuild({ field: f, collectionType: "conditional_auto" })).toBe(true);
    },
  );

  it("other fields are decided identically by both", () => {
    for (const f of ["supporting_documents", "shipping_tracking", "customer_communication", "refund_policy"]) {
      for (const collectionType of ["manual", "conditional_auto", "auto", undefined]) {
        expect(canMerchantUpload({ field: f, collectionType })).toBe(canMerchantUploadAtBuild({ field: f, collectionType }));
      }
    }
  });
});

describe("loadReturnScopeForPack: read-only, the PACK's cycle decides, a failure reads as setting off", () => {
  /** A client that records every call and THROWS on anything that is not a plain select. */
  function stub(opts: { row: { returns_outside_shopify: boolean } | null; answers?: Record<number, string>; settingsError?: boolean }) {
    const log: string[] = [];
    const sb = {
      rpc: () => {
        log.push("rpc");
        throw new Error("a read path must never call an RPC (ensure_shop_settings inserts a row)");
      },
      from: (table: string) => {
        log.push(`from:${table}`);
        const write = () => {
          log.push(`WRITE:${table}`);
          throw new Error("a read path must never write");
        };
        if (table === "shop_settings") {
          return {
            insert: write, update: write, upsert: write, delete: write,
            select: () => ({
              eq: () => ({
                maybeSingle: async () =>
                  opts.settingsError ? { data: null, error: { message: "boom" } } : { data: opts.row, error: null },
              }),
            }),
          };
        }
        return {
          insert: write, update: write, upsert: write, delete: write,
          select: () => ({
            eq: () => ({
              eq: (_c: string, cycle: number) => ({
                maybeSingle: async () => {
                  log.push(`answer:${cycle}`);
                  const a = opts.answers?.[cycle];
                  return { data: a ? { answer: a, note: null, response_cycle: cycle, answered_at: "2026-01-01" } : null };
                },
              }),
            }),
          }),
        };
      },
    };
    return { sb, log };
  }
  const run = (sb: unknown, packCycle: number) => loadReturnScopeForPack(sb as never, { shopId: "s", disputeId: "d", packCycle });

  it("never calls an RPC and never writes, in any branch", async () => {
    for (const row of [null, { returns_outside_shopify: false }, { returns_outside_shopify: true }]) {
      const { sb, log } = stub({ row, answers: { 1: "request_received" } });
      await run(sb, 1);
      expect(log.filter((l) => l === "rpc" || l.startsWith("WRITE:")), JSON.stringify(row)).toEqual([]);
    }
  });

  it("a shop with NO settings row reads as setting off, and no row is created", async () => {
    const { sb, log } = stub({ row: null });
    await expect(run(sb, 1)).resolves.toBeUndefined();
    expect(log).toEqual(["from:shop_settings"]);
  });

  it("cycle-1 pack + cycle-2 answer: the answer is ignored", async () => {
    const { sb, log } = stub({ row: { returns_outside_shopify: true }, answers: { 2: "request_received" } });
    const scope = await run(sb, 1);
    expect(log).toContain("answer:1");
    expect(log).not.toContain("answer:2");
    expect(scope).toEqual({ returnsOutsideShopify: true, answer: null });
  });

  it("cycle-2 pack + cycle-2 answer: applied", async () => {
    const { sb } = stub({ row: { returns_outside_shopify: true }, answers: { 2: "request_received" } });
    expect((await run(sb, 2))?.answer).toBe("request_received");
  });

  it("setting off: undefined, and the answer is never read", async () => {
    const { sb, log } = stub({ row: { returns_outside_shopify: false }, answers: { 1: "request_received" } });
    await expect(run(sb, 1)).resolves.toBeUndefined();
    expect(log.some((l) => l.startsWith("answer:"))).toBe(false);
  });

  it("a settings read failure is `off`, never a throw", async () => {
    const { sb } = stub({ row: null, settingsError: true });
    await expect(run(sb, 1)).resolves.toBeUndefined();
  });

  it("the presentation modules do not import getShopSettings (the RPC that inserts a row)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of [
      "lib/packs/loadReturnScope.ts",
      "lib/packs/effectiveChecklist.ts",
      "lib/packs/noReturnApplicability.ts",
      "lib/disputes/loadDecidedResponse.ts",
      "app/api/packs/[packId]/route.ts",
      "app/api/packs/[packId]/inclusion-override/route.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/import[^;]*getShopSettings|getShopSettings\(|\.rpc\(/);
    }
  });
});

describe("review follow-ups", () => {
  it("a positive stored total is `some` even when the refund section has the older shape (no refunds[])", async () => {
    const { refundStatementFromPackSections } = await import("@/lib/disputes/refundStatement");
    const sections = [
      { labelToken: { key: "packs.section.order" }, data: { totals: { refunded: "220.0", currency: "SEK" } } },
      { labelToken: { key: "packs.section.refundHistory" }, data: { refundStatus: "processed", amount: "220.0" } },
    ];
    expect(refundStatementFromPackSections(sections, null)?.kind).toBe("some");
    const zero = [
      { labelToken: { key: "packs.section.order" }, data: { totals: { refunded: "0.0" } } },
      { labelToken: { key: "packs.section.refundHistory" }, data: { refundStatus: "none" } },
    ];
    expect(refundStatementFromPackSections(zero, null)?.kind).toBe("unknown");
  });

  it("the stored 'upload manually' reason maps to a token, never to 'not applicable'", async () => {
    const { unavailableReasonToken } = await import("@/lib/disputes/unavailableReasonToken");
    expect(unavailableReasonToken("Not available automatically \u2014 upload manually if you have it")).toEqual({
      key: "disputes.unavailableReason.manualOnly",
    });
  });
});
