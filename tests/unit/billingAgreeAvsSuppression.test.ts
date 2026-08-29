import { describe, it, expect } from "vitest";
import {
  buildInternalSignalsByField,
  compareOrderAddresses,
} from "@/lib/argument/internalSignals";
import {
  classifyAvsCvv,
  classifyBillingShippingAgreement,
} from "@/app/(embedded)/app/disputes/[id]/tabs/useEvidenceSections";
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

/**
 * THE SUPPRESSION IS NOT SILENT (2026-08-29).
 *
 * Withholding the agreement note without saying anything would break the
 * Internal-only section's own promise — it is "always rendered, even when
 * empty, so the merchant always has a definitive answer to 'is anything being
 * held back?'" (`docs/technical.md`). Worse, a merchant who saw the note
 * before the change would find it gone with no explanation.
 *
 * So where the note WOULD have fired, the AVS warning gains a sentence
 * reconciling the two facts, and the title stops calling an address failure
 * "partially passed".
 */
describe("suppression is explained, not silent", () => {
  const AVS_N = {
    avsCvvStatus: "available", avsResultCode: "N",
    cvvResultCode: "M", cardCompany: "Mastercard",
  };
  const AGREE = {
    billingAddress: { city: "NYC", countryCode: "US", zipPrefix: "100" },
    shippingAddress: { city: "NYC", countryCode: "US", zipPrefix: "100" },
  };

  function avsSignal(order: unknown, avs: unknown) {
    const map = new Map<string, unknown>([
      ["order_confirmation", order],
      ["avs_cvv_match", avs],
    ]);
    return (buildInternalSignalsByField(map).get("avs_cvv_match") ?? []).find(
      (s) => s.id === "internal:avs_cvv_mismatch",
    );
  }

  it("explains the withheld note on the 72-case pattern", () => {
    const s = avsSignal(AGREE, AVS_N);
    expect(s?.reason).toContain("comparison of two addresses you hold");
    expect(s?.reason).toContain("not a check by the bank");
  });

  it("titles a definite address failure as a failure, NOT 'partially passed'", () => {
    // The regression: `avsMatched || cvvMatched` titled every one of the 72
    // cases (all CVV `M`) "Card security check partially passed".
    const s = avsSignal(AGREE, AVS_N);
    expect(s?.label).toBe("The bank's address check did not match");
    expect(s?.label).not.toMatch(/partially passed/i);
  });

  it("still says the security code matched — the fact is not suppressed, only the headline", () => {
    const s = avsSignal(AGREE, AVS_N);
    expect(s?.reason).toContain("security code");
  });

  it("does NOT add the explanation when the order's addresses did not agree", () => {
    // Nothing was withheld, so there is nothing to explain. Adding it here
    // would assert an agreement the order record does not show.
    const s = avsSignal(
      {
        billingAddress: { city: "NYC", countryCode: "US" },
        shippingAddress: { city: "LA", countryCode: "US" },
      },
      AVS_N,
    );
    expect(s?.reason).not.toContain("do agree with each other");
  });

  it("does NOT add the explanation when AVS did not definitely fail", () => {
    const s = avsSignal(AGREE, {
      avsCvvStatus: "available", avsResultCode: "U", cvvResultCode: "N",
    });
    expect(s?.reason).not.toContain("do agree with each other");
    expect(s?.label).not.toBe("The bank's address check did not match");
  });

  it("keeps 'partially passed' where it is still accurate — AVS matched, CVV failed", () => {
    const s = avsSignal(AGREE, {
      avsCvvStatus: "available", avsResultCode: "Y",
      cvvResultCode: "N", cardCompany: "Visa",
    });
    expect(s?.label).toBe("Card security check partially passed");
  });
});

/**
 * The title change must land on BOTH mirrors. The server one is asserted
 * above; this pins the client one and that the two agree, since a merchant
 * reads whichever surface they happen to be on.
 */
describe("the address-failure title reaches the client mirror too", () => {
  function clientSignal(order: unknown, avs: unknown) {
    const row = (field: string, payload: unknown): EvidenceItemWithStrength => ({
      field, label: field, status: "available", priority: "critical",
      blocking: false, source: "auto_shopify", strength: "moderate",
      impact: "critical", content: null,
      payload: payload as EvidenceItemWithStrength["payload"],
    });
    return classifyAvsCvv(
      avs,
      (k: string) => k,
      compareOrderAddresses(order),
    );
  }

  const AGREE = {
    billingAddress: { city: "NYC", countryCode: "US", zipPrefix: "100" },
    shippingAddress: { city: "NYC", countryCode: "US", zipPrefix: "100" },
  };

  it("uses the address-failed title key on a definite non-match", () => {
    const s = clientSignal(AGREE, {
      avsCvvStatus: "available", avsResultCode: "N",
      cvvResultCode: "M", cardCompany: "Mastercard",
    });
    // The fake translator returns the key, so this asserts key selection.
    expect(s?.title).toBe("internalSignals.avsCvvMismatch.titleAddressFailed");
  });

  it("explains the withheld note on the client mirror", () => {
    const s = clientSignal(AGREE, {
      avsCvvStatus: "available", avsResultCode: "N",
      cvvResultCode: "M", cardCompany: "Mastercard",
    });
    expect(s?.explanation).toContain(
      "outcomeOrderAddressesAgreeButIssuerSaysNo",
    );
  });

  it("keeps the partial title where it is still accurate", () => {
    const s = clientSignal(AGREE, {
      avsCvvStatus: "available", avsResultCode: "Y",
      cvvResultCode: "N", cardCompany: "Visa",
    });
    expect(s?.title).toBe("internalSignals.avsCvvMismatch.titlePartial");
  });
});
