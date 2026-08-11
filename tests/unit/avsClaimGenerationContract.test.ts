/**
 * The AVS generation contract — the 2026-08-11 production regression.
 *
 * ── WHAT HAPPENED ─────────────────────────────────────────────────────
 *
 * PR-C2 (C-12) split one loose AVS/CVV guard into two, each requiring its own
 * MATCH. The validator was right and stays untouched. What nobody updated was
 * the other half of the contract — the wording the writer is given.
 *
 * Two coupled defects produced 4 failed packages out of 6 regenerations on
 * 2026-08-11, every one on the same rule:
 *
 *   1. `narrativeWriter`'s rule 7 taught the exact forbidden string. Its worked
 *      example was "the billing address matched the issuer's records and the
 *      card verification code matched the issuer's records". With
 *      `verificationSummary` null, the model reproduced the most salient
 *      phrasing in its instructions.
 *
 *   2. Rule 8b then offered "provided verification details that matched issuer
 *      records" UNCONDITIONALLY, as a softer phrasing — which is the same
 *      unsupported assertion with hedging, available even when nothing matched.
 *
 * ── WHAT THIS FIX IS NOT ──────────────────────────────────────────────
 *
 * A first draft also made `citableVerificationSummaryEn` emit a security-code
 * clause for CVV-only facts, on the theory that the model reached for the
 * forbidden phrase because it had no supported sentence. Eight existing tests
 * refused it, correctly: DECISION 1 (C-12) makes a CVV-only fact
 * `bankEligible: false` / `includeInBankNarrative: false`, so it never reaches
 * the writer at all. There is no bank-facing CVV wording BY DESIGN, and adding
 * one would have re-broadened exactly what C-12 narrowed.
 *
 * The regression is entirely a PROMPT defect. No predicate, no summary and no
 * classification changes here.
 *
 * ── WHAT IS PINNED HERE ───────────────────────────────────────────────
 *
 * The three observed failure forms, as sanitized fixtures taken from the real
 * `defence_package_validation_retry` payloads, plus the four proofs that the
 * fix does not widen anything.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { runClaimGuards } from "@/lib/defence/claimGuards";
import {
  citableVerificationSummaryEn,
  citableVerificationPartsEn,
  readPaymentVerification,
  type PaymentVerification,
} from "@/lib/argument/paymentVerification";
import type { EvidenceFact } from "@/lib/defence/types";

const ROOT = resolve(__dirname, "../..");

/* ── Fixtures ────────────────────────────────────────────────────────── */

/** The three claim texts that failed in production, verbatim. */
const OBSERVED_FAILURES = [
  {
    id: "matched the issuer's records",
    dispute: "13e5165c / 11e7ac7e / 0dd0b178",
    section: "executiveSummary" as const,
    text: "The billing details submitted at checkout matched the issuer's records.",
  },
  {
    id: "billing address was verified",
    dispute: "77eb59a3",
    section: "paymentAuthenticationArgument" as const,
    text: "The billing address was verified at the time of authorization.",
  },
  {
    id: "card security code",
    dispute: "13e5165c / 11e7ac7e",
    section: "executiveSummary" as const,
    text: "The card security code was checked and accepted by the issuer.",
  },
];

/**
 * Built from RAW GATEWAY CODES, never from a hand-made `PaymentVerification`.
 *
 * The predicates read `f.value` through `readPaymentVerification`, so a fixture
 * that injected a ready-made verification object would prove the guards agree
 * with a shape production never produces. `Y` is a full AVS match (citable
 * under PR-C3's register R-E); `M` is a CVV match; `N` is a definite no-match.
 */
function codes(over: { avs?: string | null; cvv?: string | null } = {}) {
  return {
    avsResultCode: over.avs ?? null,
    cvvResultCode: over.cvv ?? null,
    network: "visa",
  };
}

function verification(over: { avs?: string | null; cvv?: string | null } = {}): PaymentVerification {
  return readPaymentVerification(codes(over));
}

function paymentFact(v: { avs?: string | null; cvv?: string | null }): EvidenceFact {
  return {
    id: "f0",
    category: "payment_authentication",
    label: "Payment authentication",
    value: codes(v),
    source: "shopify",
    sourceRef: null,
    strength: "moderate",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
  } as unknown as EvidenceFact;
}

function guardFailures(text: string, section: string, facts: EvidenceFact[]) {
  return runClaimGuards({
    narrativeSections: { [section]: { text } } as never,
    approvedFacts: facts,
  }).failures;
}

/* ── 1. The three observed failures, with NO supporting evidence ─────── */

describe("the three production failure forms are still refused without evidence", () => {
  for (const f of OBSERVED_FAILURES) {
    it(`"${f.id}" (${f.dispute}) is refused when nothing licenses it`, () => {
      const failures = guardFailures(f.text, f.section, [paymentFact({})]);
      expect(failures.length).toBeGreaterThan(0);
    });
  }

  it("the validator is UNCHANGED — this fix never weakens a predicate", () => {
    /* Guard the guard. If a later change made the guards permissive, every
     * assertion above would pass vacuously and the regression would be
     * reintroduced silently. The address claim must still be refused on a
     * CVV-ONLY fact — the exact case C-12 exists for. */
    const cvvOnly = [paymentFact({ cvv: "M" })];
    const failures = guardFailures(
      "The billing address matched the issuer's records.",
      "executiveSummary",
      cvvOnly,
    );
    expect(failures.length).toBeGreaterThan(0);
    // Named guard, not just "something failed": the ADDRESS guard is the one
    // C-12 added, and it is the one that must still fire here.
    expect(failures.some((x) => x.guardId === "avs_address_verified_claim")).toBe(true);
  });
});

/* ── 2. The library is UNCHANGED, and that is asserted ───────────────── */

describe("decision 1 still holds — no bank-facing CVV wording exists", () => {
  it("a CVV-only fact still produces NO citable summary", () => {
    /* The fix deliberately does NOT add one. `lib/argument/paymentVerification.ts`
     * is untouched by this PR; this pins that, so a later attempt to "help the
     * model" by inventing CVV prose fails here rather than in production. */
    for (const avs of [undefined, "N", "Z"]) {
      expect(
        citableVerificationSummaryEn(
          readPaymentVerification({ avsResultCode: avs, cvvResultCode: "M", network: "visa" }),
        ),
      ).toBeNull();
    }
  });

  it("a citable AVS match still produces its approved clause", () => {
    const s = citableVerificationSummaryEn(verification({ avs: "Y" }));
    expect(s).toContain("the billing address matched the issuer's records");
  });

  it("the approved clause passes the guards when the evidence licenses it", () => {
    const failures = guardFailures(
      citableVerificationSummaryEn(verification({ avs: "Y" }))!,
      "paymentAuthenticationArgument",
      [paymentFact({ avs: "Y" })],
    );
    expect(failures).toEqual([]);
  });

  it("the SAME approved clause is refused when AVS did not match", () => {
    // Wording is never authority. The predicate is.
    const licensed = citableVerificationSummaryEn(verification({ avs: "Y" }))!;
    const failures = guardFailures("Additionally, " + licensed, "executiveSummary", [
      paymentFact({ cvv: "M" }),
    ]);
    expect(failures.some((f) => f.guardId === "avs_address_verified_claim")).toBe(true);
  });

  it("the destination-role / isLicensedAvsClause protection is intact", () => {
    /* #528's hotfix: a clause opening in a destination role is the delivery
     * predicate's argument and may never be discounted as AVS prose. */
    const src = readFileSync(resolve(ROOT, "lib/defence/claimCapabilities.ts"), "utf8");
    expect(src).toMatch(/isLicensedAvsClause/);
    expect(src).toMatch(/OPENS in a destination role/i);
  });
});

/* ── 4. The prompt no longer teaches the violation ───────────────────── */

describe("the prompt states the omission rule instead of demonstrating the breach", () => {
  const src = readFileSync(resolve(ROOT, "lib/defence/narrativeWriter.ts"), "utf8");
  const prompt = src.slice(src.indexOf("BASE_SYSTEM_PROMPT"), src.indexOf("export interface GenerateNarrativeResult"));

  it("no longer contains the forbidden phrase as a worked example", () => {
    /* THE root cause. A prompt that prints the exact string a deterministic
     * validator refuses will get that string back. */
    expect(prompt).not.toMatch(/card verification\s+code matched the issuer'?s? records/i);
  });

  it("instructs OMISSION, and forbids the vaguer paraphrase", () => {
    expect(prompt).toMatch(/OMIT the subject entirely/);
    expect(prompt).toMatch(/vaguer version of the same claim/);
  });

  it("does not print the banned sentence even as a negative example", () => {
    /* The first draft of THIS fix quoted the removed 8b suggestions inside
     * their own prohibition — reproducing rule 7's original mistake one level
     * down. A prompt that prints the sentence it is banning teaches that
     * sentence; the ban is stated as a class instead. */
    expect(prompt).toMatch(/none is quoted here/);
    expect(prompt).not.toMatch(/provided verification details that matched issuer records/);
  });

  it("the prompt version was bumped, or a cached prompt would still teach it", () => {
    expect(src).toMatch(/const PROMPT_VERSION = 11;/);
  });
});


/* ── 5. The COMPLETE prompt contract ─────────────────────────────────── */

/**
 * The base prompt is not the whole instruction set. `visa_10_4_fraud`'s
 * `promptBody` is appended as a second cached system block AFTER it, so a
 * correction that stops at `narrativeWriter.ts` leaves the module free to
 * reintroduce the claim two paragraphs later. Both are asserted together.
 */
const BASE = (() => {
  const src = readFileSync(resolve(ROOT, "lib/defence/narrativeWriter.ts"), "utf8");
  return src.slice(src.indexOf("BASE_SYSTEM_PROMPT"), src.indexOf("export interface GenerateNarrativeResult"));
})();
const VISA = readFileSync(resolve(ROOT, "lib/defence/reasonCodes/visa_10_4_fraud.ts"), "utf8");

describe("the whole prompt contract, base + module", () => {
  it("never describes a security-code-ONLY summary — that input cannot exist", () => {
    /* `citableVerificationSummaryEn` produces an address clause, or an address
     * clause plus a security-code clause. Never the security-code half alone:
     * a CVV-only fact returns null AND is excluded from the bank payload by
     * decision 1. Teaching the model to handle that shape would describe an
     * impossible input and imply CVV-only prose is sometimes filable. */
    expect(BASE).not.toMatch(/ONLY a security-code clause/i);
    expect(BASE).not.toMatch(/CONTAINS ONLY a security/i);
  });

  it("offers NO card-verification paraphrase anywhere — an AVS-only case must not imply CVV", () => {
    /* Both removed 8b examples asserted card-verification evidence. On an
     * AVS-only summary — which is valid and common — they imply a security-code
     * result that does not exist. The first is the more dangerous of the two:
     * it names no code and no value, so `cvv_verified_claim`'s pattern cannot
     * catch it and the claim would ship unrefused. */
    for (const src of [BASE, VISA]) {
      expect(src).not.toMatch(/had access to card verification credentials and billing details associated with/);
      expect(src).not.toMatch(/submitted billing and card verification data that matched/);
      expect(src).not.toMatch(/provided verification details that matched issuer records/);
    }
  });

  it("both prompts require SILENCE when no summary exists, and offer no substitute", () => {
    expect(BASE).toMatch(/OMIT the subject entirely/);
    expect(BASE).toMatch(/vaguer version of the same claim/);
    expect(BASE).toMatch(/NO REPLACEMENT SENTENCE IS OFFERED/);
    expect(VISA).toMatch(/write NOTHING about AVS/);
    expect(VISA).toMatch(/no generic replacement sentence/i);
    expect(VISA).toMatch(/NO REPLACEMENT SENTENCE IS OFFERED/);
  });

  it("the Visa module no longer prioritises 'AVS+CVV match' unconditionally", () => {
    /* The module block is appended after the base prompt, so an unconditional
     * instruction here outranks the base prompt's caution by recency. */
    expect(VISA).not.toMatch(/Prioritise payment authentication signals: AVS\+CVV match/);
    expect(VISA).toMatch(/quoting the approved payment_authentication fact's `verificationSummary` verbatim/);
  });

  it("the Visa module forbids extending an address-only summary to imply CVV", () => {
    expect(VISA).toMatch(/names ONLY the billing address must never be extended to imply a security-code result/);
  });

  it("the module version was bumped — its block is cached separately", () => {
    expect(VISA).toMatch(/version: 8,/);
  });

  it("a valid AVS-only and a valid AVS+CVV summary both remain quotable verbatim", () => {
    // The fix must not have made the SUPPORTED sentence unsayable.
    const avsOnly = citableVerificationSummaryEn(verification({ avs: "Y" }))!;
    const both = citableVerificationSummaryEn(verification({ avs: "Y", cvv: "M" }))!;
    expect(guardFailures(avsOnly, "paymentAuthenticationArgument", [paymentFact({ avs: "Y" })])).toEqual([]);
    expect(
      guardFailures(both, "paymentAuthenticationArgument", [paymentFact({ avs: "Y", cvv: "M" })]),
    ).toEqual([]);
    expect(BASE).toMatch(/QUOTE verificationSummary VERBATIM/);
  });
});

/* ── 6. Rule 7 and rule 14 no longer contradict each other ───────────── */

describe("rule 14 blocks the delivery coupling, not the authentication clause", () => {
  it("rule 14 scopes its address prohibition to the DELIVERY DESTINATION", () => {
    /* Before this fix rule 14 said "never describe an address as verified,
     * matched, AVS-confirmed" with no qualifier — flatly contradicting rule 7,
     * which requires quoting a summary whose text is exactly that. Faced with
     * two rules, the model has to guess, and the audit shows which way it
     * guessed. */
    expect(BASE).toMatch(/WHAT THIS RULE DOES NOT PROHIBIT/);
    expect(BASE).toMatch(/never describe the DELIVERY DESTINATION as/);
    expect(BASE).toMatch(/isLicensedAvsClause/);
  });

  it("the structural distinction it points at is real and unchanged", () => {
    /* The prompt now cites `isLicensedAvsClause` as its authority. If that
     * function or #528's destination-opener guard were removed, the prompt
     * would be citing something that no longer enforces anything. */
    const caps = readFileSync(resolve(ROOT, "lib/defence/claimCapabilities.ts"), "utf8");
    expect(caps).toMatch(/isLicensedAvsClause/);
    expect(caps).toMatch(/OPENS in a destination role/i);
  });

  it("standalone licensed AVS passes while the destination coupling is refused", () => {
    const licensed = citableVerificationSummaryEn(verification({ avs: "Y" }))!;
    const facts = [paymentFact({ avs: "Y" })];
    // Standalone authentication statement — permitted.
    expect(guardFailures(licensed, "paymentAuthenticationArgument", facts)).toEqual([]);
    // The same words in a destination role — refused, per #528.
    const coupled = "The parcel was delivered, to the billing address that matched the issuer's records.";
    expect(guardFailures(coupled, "fulfillmentArgument", facts).length).toBeGreaterThan(0);
  });
});
