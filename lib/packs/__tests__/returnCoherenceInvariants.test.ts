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

describe("loadReturnScopeForPack: the PACK's cycle decides, a failure reads as setting off", () => {
  function mocks(settingOn: boolean, answers: Record<number, string>) {
    const calls: number[] = [];
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: (_c: string, cycle: number) => ({
              maybeSingle: async () => {
                calls.push(cycle);
                const a = answers[cycle];
                return { data: a ? { answer: a, note: null, response_cycle: cycle, answered_at: "2026-01-01" } : null };
              },
            }),
          }),
        }),
      }),
    };
    return { sb, calls, settingOn };
  }

  async function load(settingOn: boolean, answers: Record<number, string>, packCycle: number) {
    vi.resetModules();
    vi.doMock("@/lib/automation/settings", () => ({
      getShopSettings: async () => ({ returns_outside_shopify: settingOn }),
    }));
    const { loadReturnScopeForPack: fn } = await import("../loadReturnScope");
    const m = mocks(settingOn, answers);
    const scope = await fn(m.sb as never, { shopId: "s", disputeId: "d", packCycle });
    return { scope, calls: m.calls };
  }

  it("cycle-1 pack + cycle-2 answer: the answer is ignored", async () => {
    const { scope, calls } = await load(true, { 2: "request_received" }, 1);
    expect(calls).toEqual([1]);
    expect(scope).toEqual({ returnsOutsideShopify: true, answer: null });
  });

  it("cycle-2 pack + cycle-2 answer: applied", async () => {
    const { scope } = await load(true, { 2: "request_received" }, 2);
    expect(scope?.answer).toBe("request_received");
  });

  it("setting off: undefined, and the answer is never read", async () => {
    const { scope, calls } = await load(false, { 1: "request_received" }, 1);
    expect(scope).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("a settings read failure is `off`, never a throw", async () => {
    vi.resetModules();
    vi.doMock("@/lib/automation/settings", () => ({
      getShopSettings: async () => {
        throw new Error("boom");
      },
    }));
    const { loadReturnScopeForPack: fn } = await import("../loadReturnScope");
    await expect(fn({} as never, { shopId: "s", disputeId: "d", packCycle: 1 })).resolves.toBeUndefined();
  });
});

// Keep the static import used (type-level guard that the module still exports).
void loadReturnScopeForPack;
