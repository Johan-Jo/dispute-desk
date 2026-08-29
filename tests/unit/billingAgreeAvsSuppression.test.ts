import { describe, it, expect } from "vitest";
import { buildInternalSignalsByField } from "@/lib/argument/internalSignals";
import { classifyBillingShippingAgreement } from "@/app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections";
import type { EvidenceItemWithStrength } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";

/**
 * THE ISSUER OVERRULES THE ORDER RECORD (2026-08-29) — server mirror, and the
 * lockstep guard between the two implementations.
 *
 * `lib/argument/internalSignals.ts` (server-safe, field-anchored) and
 * `useEvidenceSections.ts` (client, standalone rows) both decide whether the
 * "billing and shipping addresses on the order agree" note is shown. They are
 * kept in lockstep BY COMMENT, which is exactly how the AVS `F`/`Z` drift
 * PR-C2 documents got in. This file asserts they agree on the suppression
 * predicate rather than trusting the comment.
 *
 * The measurement behind the rule is in `hasDefiniteAddressNonMatch`.
 */

const AGREEING_ORDER = {
  billingAddress: { city: "NYC", countryCode: "US", zipPrefix: "100" },
  shippingAddress: { city: "NYC", countryCode: "US", zipPrefix: "100" },
};

function serverAgreeNoteShown(avsPayload: Record<string, unknown> | null): boolean {
  const map = new Map<string, unknown>([["order_confirmation", AGREEING_ORDER]]);
  if (avsPayload !== null) map.set("avs_cvv_match", avsPayload);
  const out = buildInternalSignalsByField(map);
  return (out.get("order_confirmation") ?? []).some(
    (s) => s.id === "internal:billing_shipping_agree",
  );
}

function clientAgreeNoteShown(avsPayload: Record<string, unknown> | null): boolean {
  const row = (
    field: string,
    payload: Record<string, unknown> | null,
  ): EvidenceItemWithStrength => ({
    field,
    label: field,
    status: "available",
    priority: "critical",
    blocking: false,
    source: "auto_shopify",
    strength: "moderate",
    impact: "critical",
    content: null,
    payload,
  });
  const checklist = [row("order_confirmation", AGREEING_ORDER)];
  if (avsPayload !== null) checklist.push(row("avs_cvv_match", avsPayload));
  const result = classifyBillingShippingAgreement(checklist, (k: string) => k);
  return result?.id === "internal:billing_shipping_agree";
}

/** `shown: false` means the issuer's definite non-match withholds the note. */
const CASES: Array<{ name: string; avs: Record<string, unknown> | null; shown: boolean }> = [
  // The 72-case prod pattern: Mastercard, N, CVV M, addresses "agreeing" on
  // city + zipPrefix while the full addresses were in different states.
  { name: "N (Mastercard, CVV M) — the measured pattern", avs: { avsCvvStatus: "available", avsResultCode: "N", cvvResultCode: "M", cardCompany: "Mastercard" }, shown: false },
  { name: "Z — postal matched, street did NOT", avs: { avsCvvStatus: "available", avsResultCode: "Z", cvvResultCode: "M", cardCompany: "Mastercard" }, shown: false },
  { name: "C — international, neither component matched", avs: { avsCvvStatus: "available", avsResultCode: "C", cvvResultCode: "M", cardCompany: "Mastercard" }, shown: false },
  // Matches, and absences. Absence is never a negative signal.
  { name: "Y — full match", avs: { avsCvvStatus: "available", avsResultCode: "Y", cvvResultCode: "M", cardCompany: "Mastercard" }, shown: true },
  { name: "U — issuer supplied no result", avs: { avsCvvStatus: "available", avsResultCode: "U", cvvResultCode: "M" }, shown: true },
  { name: "S — issuer does not support AVS", avs: { avsCvvStatus: "available", avsResultCode: "S", cvvResultCode: "M" }, shown: true },
  { name: "R — issuer system unavailable at auth", avs: { avsCvvStatus: "available", avsResultCode: "R", cvvResultCode: "M" }, shown: true },
  { name: "not_applicable — PayPal/Klarna, no card", avs: { avsCvvStatus: "not_applicable", avsResultCode: null, cvvResultCode: null, gateway: "shopify_payments" }, shown: true },
  { name: "unmapped code — diagnostic only, denies nothing", avs: { avsCvvStatus: "available", avsResultCode: "Q", cvvResultCode: "M" }, shown: true },
  { name: "no AVS row at all", avs: null, shown: true },
];

describe("billing-agreement note — AVS no_match suppression (server)", () => {
  for (const c of CASES) {
    it(`${c.shown ? "shows" : "withholds"} the note — ${c.name}`, () => {
      expect(serverAgreeNoteShown(c.avs)).toBe(c.shown);
    });
  }
});

describe("server and client mirrors agree on suppression", () => {
  for (const c of CASES) {
    it(`both agree — ${c.name}`, () => {
      expect(serverAgreeNoteShown(c.avs)).toBe(clientAgreeNoteShown(c.avs));
    });
  }
});

describe("the MISMATCH half is never suppressed", () => {
  it("server still warns when AVS also says no_match", () => {
    const map = new Map<string, unknown>([
      ["order_confirmation", {
        billingAddress: { city: "NYC", countryCode: "US" },
        shippingAddress: { city: "LA", countryCode: "US" },
      }],
      ["avs_cvv_match", { avsCvvStatus: "available", avsResultCode: "N", cvvResultCode: "M" }],
    ]);
    const out = buildInternalSignalsByField(map);
    expect(
      (out.get("order_confirmation") ?? []).some(
        (s) => s.id === "internal:billing_address_mismatch",
      ),
    ).toBe(true);
  });
});
