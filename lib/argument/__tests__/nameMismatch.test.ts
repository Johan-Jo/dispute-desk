/**
 * Cardholder-name-mismatch detector + fraud-family strength cap.
 *
 * Pins the prod scenario from dispute 235d4152 (2026-07-23): card
 * registered to "Robin Denise Pipe", order placed by "Sean Boyd",
 * AVS N / CVV M, first-order account — the case must never present
 * as Strong, and the mismatch must stay merchant-UI-only.
 */

import { describe, expect, it } from "vitest";
import {
  cardholderNameFromPayload,
  detectCardholderNameMismatch,
} from "../nameMismatch";
import { calculateCaseStrength } from "../caseStrength";
import { buildInternalSignalsByField } from "../internalSignals";
import { isNonEvidenceAccountHistoryRow } from "@/lib/automation/merchantUiHiddenFields";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import { NO_GATES, gatesWith } from "@/tests/helpers/caseStrengthGates";

describe("detectCardholderNameMismatch", () => {
  it("fires when the names share no token (prod 235d4152)", () => {
    expect(
      detectCardholderNameMismatch("Robin Denise Pipe", "Sean Boyd"),
    ).toBe(true);
  });

  it("does not fire on a shared surname (family purchase)", () => {
    expect(detectCardholderNameMismatch("John Smith", "Mary Smith")).toBe(false);
  });

  it("does not fire on initials vs full name", () => {
    expect(detectCardholderNameMismatch("J. Smith", "John Smith")).toBe(false);
  });

  it("does not fire on case/diacritic differences", () => {
    expect(detectCardholderNameMismatch("JOSÉ GARCÍA", "Jose Garcia")).toBe(false);
  });

  it("handles hyphenated surnames token-wise", () => {
    expect(
      detectCardholderNameMismatch("Anna Berg-Lindqvist", "Anna Berg"),
    ).toBe(false);
  });

  it("never fires on missing or empty names (absence is not a signal)", () => {
    expect(detectCardholderNameMismatch(null, "Sean Boyd")).toBe(false);
    expect(detectCardholderNameMismatch("Robin Pipe", null)).toBe(false);
    expect(detectCardholderNameMismatch("", "")).toBe(false);
    // Initials-only degenerate input tokenizes to nothing usable.
    expect(detectCardholderNameMismatch("J B", "Sean Boyd")).toBe(false);
  });
});

describe("cardholderNameFromPayload", () => {
  it("reads and trims the gateway name", () => {
    expect(cardholderNameFromPayload({ cardholderName: " Robin Pipe " })).toBe(
      "Robin Pipe",
    );
    expect(cardholderNameFromPayload({ cardholderName: "" })).toBeNull();
    expect(cardholderNameFromPayload(null)).toBeNull();
  });
});

/* ── Strength cap ── */

const avsCvvPayload = {
  avsResultCode: "N",
  cvvResultCode: "M",
  cardholderName: "Robin Denise Pipe",
};

// PR-C1: a STRONG delivery signal comes from a genuine signature/POD only.
// This fixture needs a Strong fraud case to exercise the name-mismatch cap.
const deliveryPayload = {
  proofType: "signature_confirmed",
  signedByName: "R. Pipe",
  deliveredAt: "2026-07-10T12:00:00Z",
  fulfillments: [],
};

function item(field: string, label: string): ChecklistItemV2 {
  return {
    field,
    label,
    status: "available",
    collectionType: "automatic",
    priority: "recommended",
    blocking: false,
    source: "template",
  } as unknown as ChecklistItemV2;
}

function checklist(): ChecklistItemV2[] {
  return [
    item("avs_cvv_match", "Payment authentication"),
    item("shipping_tracking", "Shipping tracking"),
    item("device_session_consistency", "Device & session signals"),
  ];
}

const payloadSource = {
  kind: "byField" as const,
  map: {
    avs_cvv_match: { payload: avsCvvPayload },
    shipping_tracking: { payload: deliveryPayload },
    device_session_consistency: {
      payload: { consistent: true, loginPresent: true, ipMatch: true },
    },
  },
};

describe("calculateCaseStrength — cardholder-name-mismatch cap", () => {
  it("caps a Strong fraud case at moderate when triggered", () => {
    const base = calculateCaseStrength(checklist(), "FRAUDULENT", payloadSource, NO_GATES);
    expect(base.overall).toBe("strong");

    const capped = calculateCaseStrength(
      checklist(),
      "FRAUDULENT",
      payloadSource,
      gatesWith({
        nameMismatch: {
          triggered: true,
          cardholderName: "Robin Denise Pipe",
          customerName: "Sean Boyd",
        },
      }),
    );
    expect(capped.overall).toBe("moderate");
    expect(capped.nameMismatch?.capApplied).toBe(true);
    expect(capped.heroVariant).toBe("could_win");
  });

  it("is a no-op when not triggered", () => {
    const r = calculateCaseStrength(
      checklist(),
      "FRAUDULENT",
      payloadSource,
      gatesWith({
        nameMismatch: {
          triggered: false,
          cardholderName: "Sean Boyd",
          customerName: "Sean Boyd",
        },
      }),
    );
    expect(r.overall).toBe("strong");
    expect(r.nameMismatch?.capApplied).toBe(false);
  });

  it("does not cap non-fraud families", () => {
    const r = calculateCaseStrength(
      checklist(),
      "PRODUCT_NOT_RECEIVED",
      payloadSource,
      gatesWith({
        nameMismatch: {
          triggered: true,
          cardholderName: "Robin Denise Pipe",
          customerName: "Sean Boyd",
        },
      }),
    );
    expect(r.nameMismatch?.capApplied).toBe(false);
  });

  it("is a ceiling — weak stays weak", () => {
    const weakChecklist = [item("order_confirmation", "Order record")];
    const r = calculateCaseStrength(
      weakChecklist,
      "FRAUDULENT",
      { kind: "byField", map: { order_confirmation: { payload: {} } } },
      gatesWith({
        nameMismatch: {
          triggered: true,
          cardholderName: "Robin Denise Pipe",
          customerName: "Sean Boyd",
        },
      }),
    );
    expect(r.overall).toBe("weak");
    expect(r.nameMismatch?.capApplied).toBe(false);
  });
});

/* ── Internal warning (server-safe map) ── */

describe("buildInternalSignalsByField — cardholder-name mismatch warning", () => {
  it("emits a warning printing BOTH names, anchored on avs_cvv_match", () => {
    const map = buildInternalSignalsByField(
      new Map([["avs_cvv_match", avsCvvPayload]]),
      { customerName: "Sean Boyd" },
    );
    const warnings = map.get("avs_cvv_match") ?? [];
    const nameWarning = warnings.find(
      (w) => w.id === "internal:cardholder_name_mismatch",
    );
    expect(nameWarning).toBeDefined();
    expect(nameWarning!.reason).toContain("Robin Denise Pipe");
    expect(nameWarning!.reason).toContain("Sean Boyd");
    expect(nameWarning!.severity).toBe("warning");
  });

  it("emits nothing without customer-name context (back-compat)", () => {
    const map = buildInternalSignalsByField(
      new Map([["avs_cvv_match", avsCvvPayload]]),
    );
    const warnings = map.get("avs_cvv_match") ?? [];
    expect(
      warnings.find((w) => w.id === "internal:cardholder_name_mismatch"),
    ).toBeUndefined();
  });

  it("partial AVS/CVV warning: one plain combined sentence + internal-only outcome", () => {
    const map = buildInternalSignalsByField(
      new Map([["avs_cvv_match", avsCvvPayload]]),
      { customerName: "Sean Boyd" },
    );
    const avsWarning = (map.get("avs_cvv_match") ?? []).find(
      (w) => w.id === "internal:avs_cvv_mismatch",
    );
    expect(avsWarning).toBeDefined();
    // TITLE CHANGED 2026-08-29. This is AVS `N` + CVV `M` — a definite address
    // non-match, the exact 72-case prod pattern. It used to title as
    // "partially passed" because the ternary read `avsMatched || cvvMatched`,
    // letting a security-code match summarise an address failure. A CVV match
    // is not an address match (PR-C2 decision 1), in the headline as in the
    // citation.
    expect(avsWarning!.label).toBe("The bank's address check did not match");
    // Plain-language rule: describe WHAT happened, codes in parentheses
    // at the end — never lead with a bare gateway code.
    // PR-C2 (C-12) decision 1: the security-code match is NOT cited. The
    // previous copy told the merchant the opposite of what the system does.
    expect(avsWarning!.reason).toBe(
      "The address did not match the card issuer's records, but the card's security code did (AVS N, CVV M). " +
        "The matching security code is kept as an internal record — it is not cited in the dispute response, " +
        "because a security-code match is not an address match.",
    );
  });

  it("AVS Z + CVV M renders the same grouped 'did not match' sentence", () => {
    const map = buildInternalSignalsByField(
      new Map([
        [
          "avs_cvv_match",
          { avsResultCode: "Z", cvvResultCode: "M", cardholderName: "Robin Denise Pipe" },
        ],
      ]),
    );
    const w = (map.get("avs_cvv_match") ?? []).find(
      (x) => x.id === "internal:avs_cvv_mismatch",
    );
    expect(w).toBeDefined();
    expect(w!.reason).toContain(
      "The address did not match the card issuer's records, but the card's security code did (AVS Z, CVV M).",
    );
  });

  it("unchecked AVS (code U) reads as not checked, never as a mismatch", () => {
    const map = buildInternalSignalsByField(
      new Map([["avs_cvv_match", { avsResultCode: "U", cvvResultCode: "M" }]]),
    );
    const w = (map.get("avs_cvv_match") ?? []).find(
      (x) => x.id === "internal:avs_cvv_mismatch",
    );
    expect(w).toBeDefined();
    expect(w!.reason).toBe(
      "The issuer did not check the address; the card's security code matched (AVS U, CVV M). " +
        "The matching security code is kept as an internal record — it is not cited in the dispute response, " +
        "because a security-code match is not an address match.",
    );
  });

  it("both failed reads as one sentence + nothing-cited outcome", () => {
    const map = buildInternalSignalsByField(
      new Map([["avs_cvv_match", { avsResultCode: "N", cvvResultCode: "N" }]]),
    );
    const w = (map.get("avs_cvv_match") ?? []).find(
      (x) => x.id === "internal:avs_cvv_mismatch",
    );
    expect(w).toBeDefined();
    // Both halves failed, so the address failed: same title as any other
    // definite address non-match (2026-08-29).
    expect(w!.label).toBe("The bank's address check did not match");
    expect(w!.reason).toBe(
      "Neither the address nor the card's security code matched the issuer's records (AVS N, CVV N). " +
        "Neither result was cited as evidence in the dispute response — only results that strengthen the case go to the bank.",
    );
  });
});

/* ── Non-evidence account-history row (2026-07-23 user decision) ── */

describe("isNonEvidenceAccountHistoryRow", () => {
  it("hides a first-time customer on a fraud dispute", () => {
    expect(
      isNonEvidenceAccountHistoryRow(
        "customer_account_info",
        { totalOrders: 1, isRepeatCustomer: false },
        "fraud",
      ),
    ).toBe(true);
  });

  it("hides when the payload carries no order-count signal at all", () => {
    expect(
      isNonEvidenceAccountHistoryRow("customer_account_info", {}, "fraud"),
    ).toBe(true);
  });

  it("keeps a returning customer (that IS evidence)", () => {
    expect(
      isNonEvidenceAccountHistoryRow(
        "customer_account_info",
        { totalOrders: 3, isRepeatCustomer: true },
        "fraud",
      ),
    ).toBe(false);
  });

  it("keeps the row on non-fraud families", () => {
    expect(
      isNonEvidenceAccountHistoryRow(
        "customer_account_info",
        { totalOrders: 1, isRepeatCustomer: false },
        "delivery",
      ),
    ).toBe(false);
  });

  it("never touches other fields", () => {
    expect(isNonEvidenceAccountHistoryRow("activity_log", {}, "fraud")).toBe(false);
  });
});
