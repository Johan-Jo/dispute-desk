/**
 * PR 0 parity (docs/plans/single-source-architecture-audit.plan.md §2.4).
 *
 * The two copies of the requirement-mode rules (`resolveRequirement` and the
 * switch inside `resolveItemStatus`) were merged into one body. This file
 * proves the merge changed nothing, three ways:
 *
 *  (i)  `resolveRequirement` against a FROZEN copy of the pre-merge code, over
 *       every mode x every order context.
 *  (ii) `resolveItemStatus` against a FROZEN copy, over every mode x context x
 *       {present, waived, absent} x field.
 *  (iii) `evaluateCompleteness` / `evaluateCompletenessV2` end to end: a
 *       sha256 per reason over a grid of contexts, captured from the code
 *       BEFORE the merge (the fixture) and compared byte-for-byte.
 *
 * The frozen copies are deliberately NOT imported from production code; they
 * are the independent expectation. Do not "simplify" them to call the
 * implementation.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateCompleteness,
  evaluateCompletenessV2,
  resolveItemStatus,
  resolveRequirement,
  type OrderContext,
  type RequirementMode,
  type TemplateChecklistItem,
} from "../completeness";

const MODES: RequirementMode[] = [
  "required_always",
  "required_if_fulfilled",
  "required_if_card_payment",
  "required_if_refunded",
  "required_if_returned_to_sender",
  "recommended",
  "optional",
];

const TRI = [undefined, true, false] as const;

function* contexts(): Generator<OrderContext> {
  for (const isFulfilled of [true, false])
    for (const hasCardPayment of [true, false])
      for (const avsCvvAvailable of [true, false])
        for (const hasRefund of TRI)
          for (const hasReturnedToSenderParcel of TRI)
            for (const hasShippingEvidence of TRI) {
              const ctx: OrderContext = { isFulfilled, hasCardPayment, avsCvvAvailable };
              if (hasRefund !== undefined) ctx.hasRefund = hasRefund;
              if (hasReturnedToSenderParcel !== undefined) ctx.hasReturnedToSenderParcel = hasReturnedToSenderParcel;
              if (hasShippingEvidence !== undefined) ctx.hasShippingEvidence = hasShippingEvidence;
              yield ctx;
            }
}

/* ── FROZEN pre-merge copies (independent expectation) ─────────────────── */

function legacyResolveRequirement(mode: RequirementMode, ctx: OrderContext) {
  switch (mode) {
    case "required_always":
      return { required: true, collectable: true };
    case "required_if_fulfilled":
      if (!ctx.isFulfilled) {
        return { required: false, collectable: false, unavailableReason: "Order is unfulfilled" };
      }
      return { required: true, collectable: true };
    case "required_if_card_payment":
      if (!ctx.hasCardPayment) {
        return { required: false, collectable: false, unavailableReason: "No card payment on this order" };
      }
      if (!ctx.avsCvvAvailable) {
        return { required: false, collectable: false, unavailableReason: "AVS/CVV not returned by payment gateway" };
      }
      return { required: true, collectable: true };
    case "required_if_refunded":
      if (!ctx.hasRefund) {
        return { required: false, collectable: false, unavailableReason: "No refund was issued on this order" };
      }
      return { required: true, collectable: true };
    case "required_if_returned_to_sender":
      if (!ctx.hasReturnedToSenderParcel) {
        return { required: false, collectable: false, unavailableReason: "No parcel on this order was returned to sender" };
      }
      return { required: true, collectable: true };
    case "recommended":
      return { required: false, collectable: true };
    case "optional":
      return { required: false, collectable: true };
  }
}

function legacyResolveItemStatus(
  mode: RequirementMode,
  ctx: OrderContext,
  isPresent: boolean,
  waived: boolean,
  field?: string,
): { status: string; collectable: boolean; unavailableReason?: string } {
  if (waived) return { status: "waived", collectable: true };
  if (isPresent) return { status: "available", collectable: true };
  switch (mode) {
    case "required_if_fulfilled":
      if (!ctx.isFulfilled) {
        const inTransit = field === "delivery_proof" && ctx.hasShippingEvidence === true;
        return {
          status: "unavailable",
          collectable: false,
          unavailableReason: inTransit ? "Awaiting delivery confirmation" : "Order is unfulfilled",
        };
      }
      break;
    case "required_if_card_payment":
      if (!ctx.hasCardPayment) {
        return { status: "unavailable", collectable: false, unavailableReason: "No card payment on this order" };
      }
      if (!ctx.avsCvvAvailable) {
        return { status: "unavailable", collectable: false, unavailableReason: "AVS/CVV not returned by payment gateway" };
      }
      break;
    case "required_if_refunded":
      if (!ctx.hasRefund) {
        return { status: "unavailable", collectable: false, unavailableReason: "No refund was issued on this order" };
      }
      break;
    case "required_if_returned_to_sender":
      if (!ctx.hasReturnedToSenderParcel) {
        return { status: "unavailable", collectable: false, unavailableReason: "No parcel on this order was returned to sender" };
      }
      break;
  }
  return { status: "missing", collectable: true };
}

/** JSON with undefined-valued keys kept visible (a dropped key is a diff). */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (val === undefined ? "__undefined__" : val));
}

describe("PR 0 parity: requirement-mode rules", () => {
  it("(i) resolveRequirement matches the frozen pre-merge copy over every mode x context", () => {
    let n = 0;
    for (const ctx of contexts()) {
      for (const mode of MODES) {
        expect(stable(resolveRequirement(mode, ctx)), `${mode} ${JSON.stringify(ctx)}`).toBe(
          stable(legacyResolveRequirement(mode, ctx)),
        );
        n++;
      }
    }
    expect(n).toBe(MODES.length * 2 * 2 * 2 * 3 * 3 * 3);
  });

  it("(ii) resolveItemStatus matches the frozen copy over mode x context x {present, waived, absent} x field", () => {
    const waivedRecord = { field: "x", reason: "other", waivedAt: "2026-01-01T00:00:00Z" } as never;
    let n = 0;
    for (const ctx of contexts()) {
      for (const mode of MODES) {
        for (const field of ["delivery_proof", "shipping_tracking", undefined]) {
          for (const state of ["present", "waived", "absent", "present_and_waived"] as const) {
            const isPresent = state === "present" || state === "present_and_waived";
            const waived = state === "waived" || state === "present_and_waived";
            const got = resolveItemStatus(mode, ctx, isPresent, waived ? waivedRecord : undefined, field);
            expect(stable(got), `${mode} ${state} ${field} ${JSON.stringify(ctx)}`).toBe(
              stable(legacyResolveItemStatus(mode, ctx, isPresent, waived, field)),
            );
            n++;
          }
        }
      }
    }
    expect(n).toBe(MODES.length * 216 * 3 * 4);
  });
});

/* ── (iii) end-to-end hashes captured BEFORE the merge ─────────────────── */

const REASONS: Array<string | null> = [
  null,
  "FRAUDULENT",
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "CREDIT_NOT_PROCESSED",
  "SUBSCRIPTION_CANCELED",
  "SUBSCRIPTION_CANCELLED",
  "DUPLICATE",
  "GENERAL",
  "UNRECOGNIZED",
  "INCORRECT_ACCOUNT_DETAILS",
  "BANK_CANNOT_PROCESS",
  "CUSTOMER_INITIATED",
  "DEBIT_NOT_AUTHORIZED",
  "INSUFFICIENT_FUNDS",
  "NOT_A_REAL_REASON",
];

const FIELDS = [
  "order_confirmation",
  "shipping_tracking",
  "delivery_proof",
  "avs_cvv_match",
  "refund_record",
  "no_return_initiated",
  "returned_parcel_outcome",
  "customer_communication",
  "refund_policy",
  "manual_upload",
];

function dbTemplate(): TemplateChecklistItem[] {
  return MODES.flatMap((m, i) =>
    [FIELDS[i % FIELDS.length], FIELDS[(i + 3) % FIELDS.length]].map((f, j) => ({
      key: `${m}_${j}`,
      label: `${m} ${j}`,
      required: m === "required_always",
      collector_key: j === 0 ? f : null,
      requirement_mode: m,
    })),
  );
}

function present(sel: "none" | "all" | "half"): Set<string> {
  if (sel === "none") return new Set();
  if (sel === "all") return new Set(FIELDS);
  return new Set(FIELDS.filter((_, i) => i % 2 === 0));
}

function digestFor(reason: string | null): { cases: number; sha256: string } {
  const h = createHash("sha256");
  let cases = 0;
  const waived = [{ field: "refund_record", reason: "other", waivedAt: "2026-01-01T00:00:00Z" } as never];
  for (const ctx of contexts()) {
    for (const sel of ["none", "half", "all"] as const) {
      const p = present(sel);
      for (const tpl of [null, dbTemplate()]) {
        h.update(stable(evaluateCompleteness(reason, p, tpl, ctx)));
        h.update(stable(evaluateCompletenessV2(reason, p, null, tpl, ctx)));
        h.update(stable(evaluateCompletenessV2(reason, p, waived, tpl, ctx)));
        cases += 3;
      }
    }
  }
  return { cases, sha256: h.digest("hex") };
}

const FIXTURE = join(__dirname, "__fixtures__", "completenessModeParity.json");

describe("PR 0 parity: evaluateCompleteness / evaluateCompletenessV2 byte-identical", () => {
  it("(iii) matches the digests captured from the pre-merge code", () => {
    const actual: Record<string, { cases: number; sha256: string }> = {};
    for (const r of REASONS) actual[String(r)] = digestFor(r);

    if (process.env.CAPTURE_PARITY_FIXTURE === "1") {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + "\n");
      return;
    }
    expect(existsSync(FIXTURE), "fixture missing: capture it from the PRE-merge code").toBe(true);
    const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof actual;
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const k of Object.keys(expected)) expect(actual[k], `reason ${k}`).toEqual(expected[k]);
  });
});
