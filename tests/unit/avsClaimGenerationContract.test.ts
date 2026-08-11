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

  it("names the CVV-only case and forbids address prose in it", () => {
    expect(prompt).toMatch(/ONLY a security-code clause/);
  });

  it("the softer 8b phrasings are conditional on a summary existing", () => {
    expect(prompt).toMatch(/ONLY when verificationSummary is\s*\n?\s*present/);
    // The unconditional "matched issuer records" line is gone: it asserted a
    // match in a rule whose whole purpose is cases where none is proven.
    expect(prompt).not.toMatch(/provided verification details that matched issuer records/);
  });

  it("the prompt version was bumped, or a cached prompt would still teach it", () => {
    expect(src).toMatch(/const PROMPT_VERSION = 11;/);
  });
});
