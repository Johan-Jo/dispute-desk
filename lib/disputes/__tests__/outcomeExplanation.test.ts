import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import {
  deriveOutcomeFactors,
  outcomeExplanationToken,
  resolveOutcomeExplanation,
} from "@/lib/disputes/outcomeExplanation";

/**
 * The shape of `defence_packages.facts_json` as persisted in production.
 * Copied from order #349145 v4 (prod `aokhplydttxtebvbeuzc`, the case in
 * the bug report) so the tests bind to the real schema rather than an
 * idealised one — `fieldKey` lives inside `value`, not at the top level,
 * which is exactly the sort of detail a hand-written fixture gets wrong.
 */
const fact = (value: Record<string, unknown>) => ({
  id: "f",
  label: "l",
  value,
  source: "shopify_order",
  category: "c",
  strength: "moderate",
  bankEligible: true,
});

/** Facts as they actually stand on #349145: AVS N, delivered but unsigned. */
const FACTS_349145 = [
  fact({ fieldKey: "avs_cvv_match", avsResult: "N", cvvResult: "M" }),
  fact({
    fieldKey: "delivery_proof",
    proofType: "delivered_confirmed",
    deliveredAt: "2026-06-29T22:44:00Z",
    signedByName: null,
  }),
  fact({ fieldKey: "ip_location_check", locationMatch: "same_country" }),
];

/** The `disputes.outcomeExplanation` block of a loaded message bundle. */
function msgBlock(messages: unknown): any {
  return (messages as any).disputes.outcomeExplanation;
}

function lookup(key: string): string | undefined {
  return key
    .split(".")
    .reduce<unknown>(
      (n, p) => (typeof n === "object" && n !== null ? (n as Record<string, unknown>)[p] : undefined),
      enMessages,
    ) as string | undefined;
}

describe("outcomeExplanation — the reported bug", () => {
  it("a lost dispute we defended never renders assessment vocabulary", () => {
    const explanation = resolveOutcomeExplanation({
      outcome: "lost",
      reason: "FRAUDULENT",
      pack: { submittedAt: "2026-08-09T08:10:48Z", facts: FACTS_349145 },
    });
    expect(explanation.kind).toBe("we_defended_with_facts");

    const token = outcomeExplanationToken(explanation, "lost", "Aug 9, 2026");
    expect(token).not.toBeNull();

    const template = lookup(token!.key)!;
    const clause = lookup(
      (token!.params!.clause as { key: string }).key,
    )!;
    const rendered = template
      .replace("{date}", "Aug 9, 2026")
      .replace("{clause}", clause);

    // The two strings the screenshot showed, on a case carrying a fully
    // submitted defence package.
    expect(rendered).not.toContain("Not yet assessed");
    expect(rendered).not.toContain("No evidence available");
    expect(rendered).toContain("We filed your evidence on Aug 9, 2026");
    expect(rendered).toContain("billing address did not match");
  });

  it("never leaks a bare gateway code into merchant copy", () => {
    for (const key of Object.keys(
      msgBlock(enMessages)["factor"] as Record<string, string>,
    )) {
      const s = lookup(`disputes.outcomeExplanation.factor.${key}`)!;
      expect(s).not.toMatch(/\bAVS\b|\bCVV\b|\b4837\b|\b10\.4\b/);
    }
  });
});

describe("outcomeExplanation — state resolution", () => {
  it("no defence package is 'not defended by us', whatever the dispute row says", () => {
    // The 390 historical imports carry submission_state='submitted_confirmed'
    // while closing before the shop installed. Only pack presence may decide.
    const explanation = resolveOutcomeExplanation({
      outcome: "lost",
      reason: "FRAUDULENT",
      pack: null,
    });
    expect(explanation.kind).toBe("not_defended_by_us");

    const token = outcomeExplanationToken(explanation, "lost", "Aug 9, 2026")!;
    const rendered = lookup(token.key)!;
    expect(rendered).toContain("before DisputeDesk filed any evidence");
    expect(rendered).not.toContain("We filed your evidence");
  });

  it("a package with no usable facts still says we filed", () => {
    const explanation = resolveOutcomeExplanation({
      outcome: "lost",
      reason: "CREDIT_NOT_PROCESSED",
      pack: { submittedAt: "2026-08-09T08:10:48Z", facts: [] },
    });
    expect(explanation.kind).toBe("we_defended_no_facts");

    const token = outcomeExplanationToken(explanation, "lost", "Aug 9, 2026")!;
    const rendered = lookup(token.key)!.replace("{date}", "Aug 9, 2026");
    expect(rendered).toContain("We filed your evidence");
  });

  it("returns no token when the filing date is unknown", () => {
    const explanation = resolveOutcomeExplanation({
      outcome: "lost",
      reason: "FRAUDULENT",
      pack: { submittedAt: null, facts: FACTS_349145 },
    });
    expect(outcomeExplanationToken(explanation, "lost", null)).toBeNull();
  });
});

describe("deriveOutcomeFactors — loss side", () => {
  it("ranks the AVS mismatch first on #349145", () => {
    const factors = deriveOutcomeFactors({
      facts: FACTS_349145,
      reason: "FRAUDULENT",
      outcome: "lost",
    });
    expect(factors[0].code).toBe("avs_mismatch");
    expect(factors[0].confidence).toBe("observed");
    // Delivery WAS confirmed, so the missing-delivery factor must not fire.
    expect(factors.map((f) => f.code)).not.toContain("no_delivery_confirmation");
    expect(factors.map((f) => f.code)).toContain("no_signature_on_fraud");
  });

  it("an unsigned delivery is only a factor on a fraud claim", () => {
    const codes = (reason: string) =>
      deriveOutcomeFactors({ facts: FACTS_349145, reason, outcome: "lost" }).map(
        (f) => f.code,
      );
    expect(codes("FRAUDULENT")).toContain("no_signature_on_fraud");
    // On a not-received claim delivery itself is the question; who signed
    // for it is not the interesting fact.
    expect(codes("PRODUCT_NOT_RECEIVED")).not.toContain("no_signature_on_fraud");
  });

  it("missing delivery proof is only a factor where delivery is at issue", () => {
    // Caught by the empty-facts case: on a credit-not-processed dispute the
    // parcel is not what the bank weighs, so "no delivery confirmation" is a
    // true statement that explains nothing and reads as our own failure.
    const codes = (reason: string) =>
      deriveOutcomeFactors({ facts: [], reason, outcome: "lost" }).map((f) => f.code);
    for (const reason of ["FRAUDULENT", "PRODUCT_NOT_RECEIVED", "PRODUCT_UNACCEPTABLE"]) {
      expect(codes(reason), reason).toContain("no_delivery_confirmation");
    }
    for (const reason of ["CREDIT_NOT_PROCESSED", "DUPLICATE", "SUBSCRIPTION_CANCELLED"]) {
      expect(codes(reason), reason).not.toContain("no_delivery_confirmation");
    }
  });

  it("returns an empty array rather than padding with filler", () => {
    const factors = deriveOutcomeFactors({
      facts: [
        fact({ fieldKey: "avs_cvv_match", avsResult: "Y", cvvResult: "M" }),
        fact({
          fieldKey: "delivery_proof",
          proofType: "signature_confirmed",
          signedByName: "K. Ferreira",
        }),
      ],
      reason: "CREDIT_NOT_PROCESSED",
      outcome: "lost",
    });
    expect(factors).toEqual([]);
  });

  it("reads AVS through the canonical owner, not a local letter set", () => {
    // Semantics come from `readPaymentVerification` (network-aware). A
    // second match set here is the defect
    // `tests/unit/paymentVerificationSingleOwner.test.ts` forbids, so this
    // asserts the OUTCOME of that owner rather than re-listing letters.
    const has = (value: Record<string, unknown>) =>
      deriveOutcomeFactors({
        facts: [fact({ fieldKey: "avs_cvv_match", ...value })],
        reason: "CREDIT_NOT_PROCESSED",
        outcome: "lost",
      }).some((f) => f.code === "avs_mismatch");

    expect(has({ avsResult: "N" })).toBe(true);
    expect(has({ avsResult: "Y" })).toBe(false);
    // An absent code is "unchecked": the issuer returned nothing. Absence of
    // evidence must never render as evidence of a mismatch.
    expect(has({})).toBe(false);
  });

  it("accepts the historical avs payload shapes still live in facts_json", () => {
    // `readPaymentVerification` normalizes three spellings; a fact written by
    // an older collector must still resolve.
    for (const value of [
      { avsResult: "N" },
      { avsResultCode: "N" },
      { avs_result_code: "N" },
    ]) {
      const factors = deriveOutcomeFactors({
        facts: [fact({ fieldKey: "avs_cvv_match", ...value })],
        reason: "CREDIT_NOT_PROCESSED",
        outcome: "lost",
      });
      expect(factors.map((f) => f.code), JSON.stringify(value)).toContain("avs_mismatch");
    }
  });

  it("tolerates malformed facts_json without throwing", () => {
    for (const facts of [null, undefined, "not-an-array", [null], [{}], [{ value: 3 }]]) {
      expect(() =>
        deriveOutcomeFactors({ facts, reason: "FRAUDULENT", outcome: "lost" }),
      ).not.toThrow();
    }
  });
});

describe("deriveOutcomeFactors — won side", () => {
  it("names the signature when one exists", () => {
    const factors = deriveOutcomeFactors({
      facts: [
        fact({
          fieldKey: "delivery_proof",
          proofType: "signature_confirmed",
          signedByName: "K. Ferreira",
        }),
        fact({ fieldKey: "avs_cvv_match", avsResult: "Y" }),
      ],
      reason: "FRAUDULENT",
      outcome: "won",
    });
    expect(factors[0].code).toBe("signature_confirmed");
  });

  it("fires nothing on a Klarna win — no card network, so no AVS or signature", () => {
    // The only won dispute in production holding a package is a Klarna
    // inquiry (`cardNetwork: null`). These predicates cannot apply there,
    // and the caller must degrade to the plain sentence.
    const factors = deriveOutcomeFactors({
      facts: [fact({ fieldKey: "order_record", fulfillmentStatus: "FULFILLED" })],
      reason: "PRODUCT_NOT_RECEIVED",
      outcome: "won",
    });
    expect(factors).toEqual([]);
    const explanation = resolveOutcomeExplanation({
      outcome: "won",
      reason: "PRODUCT_NOT_RECEIVED",
      pack: { submittedAt: "2026-08-09T08:10:48Z", facts: [] },
    });
    expect(explanation.kind).toBe("we_defended_no_facts");
  });
});

describe("i18n parity", () => {
  const LOCALES = ["en", "de", "es", "fr", "pt", "sv"] as const;

  it("every key exists in all six locales, with placeholders intact", async () => {
    const keys = Object.keys(msgBlock(enMessages)["factor"]);
    for (const loc of LOCALES) {
      const m = (await import(`@/messages/${loc}.json`)).default;
      const block = msgBlock(m);
      expect(block, `${loc} missing outcomeExplanation`).toBeTruthy();
      expect(Object.keys(block["factor"]).sort()).toEqual(keys.sort());

      for (const outcome of ["won", "lost"]) {
        const withFactor = block["filedWithFactor"][outcome] as string;
        const noFactors = block["filedNoFactors"][outcome] as string;
        // A dropped placeholder renders a literal "{date}" to a merchant.
        expect(withFactor, `${loc}.${outcome}`).toContain("{date}");
        expect(withFactor, `${loc}.${outcome}`).toContain("{clause}");
        expect(noFactors, `${loc}.${outcome}`).toContain("{date}");
      }
      expect(typeof block["notDefendedByUs"]).toBe("string");
    }
  });

  it("the composed sentence stays inside the header's two-line budget", () => {
    const block = msgBlock(enMessages);
    for (const outcome of ["won", "lost"]) {
      for (const clause of Object.values(block["factor"]) as string[]) {
        const rendered = (block["filedWithFactor"][outcome] as string)
          .replace("{date}", "Aug 9, 2026")
          .replace("{clause}", clause);
        expect(rendered.length, rendered).toBeLessThanOrEqual(180);
      }
    }
  });
});
