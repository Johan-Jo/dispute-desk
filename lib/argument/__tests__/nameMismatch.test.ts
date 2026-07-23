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
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

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

const deliveryPayload = {
  proofType: "delivered_confirmed",
  deliveredToVerifiedAddress: true,
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
    const base = calculateCaseStrength(checklist(), "FRAUDULENT", payloadSource);
    expect(base.overall).toBe("strong");

    const capped = calculateCaseStrength(
      checklist(),
      "FRAUDULENT",
      payloadSource,
      undefined,
      undefined,
      undefined,
      {
        triggered: true,
        cardholderName: "Robin Denise Pipe",
        customerName: "Sean Boyd",
      },
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
      undefined,
      undefined,
      undefined,
      { triggered: false, cardholderName: "Sean Boyd", customerName: "Sean Boyd" },
    );
    expect(r.overall).toBe("strong");
    expect(r.nameMismatch?.capApplied).toBe(false);
  });

  it("does not cap non-fraud families", () => {
    const r = calculateCaseStrength(
      checklist(),
      "PRODUCT_NOT_RECEIVED",
      payloadSource,
      undefined,
      undefined,
      undefined,
      {
        triggered: true,
        cardholderName: "Robin Denise Pipe",
        customerName: "Sean Boyd",
      },
    );
    expect(r.nameMismatch?.capApplied).toBe(false);
  });

  it("is a ceiling — weak stays weak", () => {
    const weakChecklist = [item("order_confirmation", "Order record")];
    const r = calculateCaseStrength(
      weakChecklist,
      "FRAUDULENT",
      { kind: "byField", map: { order_confirmation: { payload: {} } } },
      undefined,
      undefined,
      undefined,
      {
        triggered: true,
        cardholderName: "Robin Denise Pipe",
        customerName: "Sean Boyd",
      },
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

  it("partial AVS/CVV warning names the cited half, not a blanket withhold", () => {
    const map = buildInternalSignalsByField(
      new Map([["avs_cvv_match", avsCvvPayload]]),
      { customerName: "Sean Boyd" },
    );
    const avsWarning = (map.get("avs_cvv_match") ?? []).find(
      (w) => w.id === "internal:avs_cvv_mismatch",
    );
    expect(avsWarning).toBeDefined();
    expect(avsWarning!.label).toBe("Card security check partially passed");
    expect(avsWarning!.reason).toContain("AVS code N");
    expect(avsWarning!.reason).toContain("CVV code M");
    expect(avsWarning!.reason).toContain("cited in the response");
  });
});
