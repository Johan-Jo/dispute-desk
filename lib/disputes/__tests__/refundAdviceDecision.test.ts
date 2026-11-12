/**
 * The send rule for the refund-advice email. Every skip is a case where the email would be wrong or unmeasured.
 * Shapes follow the 2026-11-12 live reads: #24697-style (none) sends; #25054-style (settled) never does.
 */
import { describe, expect, it } from "vitest";
import { decideRefundAdvice, isKlarnaMethod, type RefundAdviceInput } from "../refundAdviceDecision";
import type { RefundState } from "../refundState";

const state = (kind: RefundState["kind"], patch: Partial<RefundState> = {}): RefundState => ({
  kind,
  reason: kind === "unknown" ? "truncated" : null,
  pendingAmount: 0,
  settledAmount: 0,
  failedAmount: 0,
  currency: "SEK",
  firstRefundAt: null,
  settledAt: null,
  stalledPending: false,
  returnStatus: "IN_PROGRESS",
  paymentGateways: ["shopify_payments"],
  financialStatus: "PAID",
  ...patch,
});

const base = (patch: Partial<RefundAdviceInput> = {}): RefundAdviceInput => ({
  emailsEnabled: true,
  phase: "inquiry",
  status: "needs_response",
  reason: "CREDIT_NOT_PROCESSED",
  state: state("none"),
  paymentMethod: "klarna",
  optedOut: false,
  hasTeamEmail: true,
  alreadySent: false,
  ...patch,
});

describe("decideRefundAdvice", () => {
  it("sends the advice for an open Klarna credit-not-processed inquiry with a return and no refund", () => {
    expect(decideRefundAdvice(base())).toEqual({ action: "send", variant: "none" });
    expect(decideRefundAdvice(base({ state: state("none", { returnStatus: "RETURNED" }) }))).toEqual({ action: "send", variant: "none" });
  });

  it("sends the failed variant when every refund transaction failed", () => {
    expect(decideRefundAdvice(base({ state: state("failed", { failedAmount: 429 }) }))).toEqual({ action: "send", variant: "failed" });
  });

  it.each([
    ["pending", "state_pending"],
    ["settled", "state_settled"],
    ["mixed", "state_mixed"],
    ["unknown", "state_unknown"],
  ] as const)("never sends while the refund state is %s", (kind, reason) => {
    expect(decideRefundAdvice(base({ state: state(kind) }))).toEqual({ action: "skip", reason });
  });

  it("never sends on a chargeback, a closed dispute or another reason", () => {
    expect(decideRefundAdvice(base({ phase: "chargeback" }))).toEqual({ action: "skip", reason: "not_inquiry" });
    expect(decideRefundAdvice(base({ phase: null }))).toEqual({ action: "skip", reason: "not_inquiry" });
    expect(decideRefundAdvice(base({ status: "won" }))).toEqual({ action: "skip", reason: "not_open" });
    expect(decideRefundAdvice(base({ status: "under_review" }))).toEqual({ action: "skip", reason: "not_open" });
    expect(decideRefundAdvice(base({ reason: "PRODUCT_NOT_RECEIVED" }))).toEqual({ action: "skip", reason: "not_credit_not_processed" });
  });

  it("needs a return open or received on the order", () => {
    for (const returnStatus of ["NO_RETURN", "RETURN_REQUESTED", "RETURN_FAILED", null]) {
      expect(decideRefundAdvice(base({ state: state("none", { returnStatus }) }))).toEqual({ action: "skip", reason: "no_return" });
    }
  });

  it("is Klarna-only until other methods are measured", () => {
    for (const paymentMethod of ["paypal", "card", "shopify_pay", null]) {
      expect(decideRefundAdvice(base({ paymentMethod }))).toEqual({ action: "skip", reason: "not_klarna" });
    }
    for (const m of ["klarna", "klarna_pay_later", "klarna_pay_now", "klarna_slice_it", "Klarna"]) expect(isKlarnaMethod(m)).toBe(true);
    expect(isKlarnaMethod("paypal")).toBe(false);
  });

  it("respects the kill switch, the opt-out, a missing team email and an earlier send", () => {
    expect(decideRefundAdvice(base({ emailsEnabled: false }))).toEqual({ action: "skip", reason: "disabled" });
    expect(decideRefundAdvice(base({ optedOut: true }))).toEqual({ action: "skip", reason: "opted_out" });
    expect(decideRefundAdvice(base({ hasTeamEmail: false }))).toEqual({ action: "skip", reason: "no_team_email" });
    expect(decideRefundAdvice(base({ alreadySent: true }))).toEqual({ action: "skip", reason: "already_sent" });
  });
});
