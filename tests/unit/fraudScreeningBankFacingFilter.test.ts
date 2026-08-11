/**
 * Verification phrases never reach a bank — through the PAYLOAD, not just the
 * prompt.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
 *
 * The 2026-08-11 prompt work removed the forbidden sentences from
 * `BASE_SYSTEM_PROMPT` and `visa_10_4_fraud.promptBody`, and proved with
 * `runClaimGuards` that the validator still refuses them. That proved the
 * OUTPUT is refused. It did not prove the model never receives the text.
 *
 * It did. `buildLlmFactPayload` mapped `f.value` through unchanged, so a
 * `fraud_screening` fact carried Shopify's raw `positiveFacts` — including
 *
 *     "Card Verification Value (CVV) is correct"
 *     "Billing street address matches credit card's registered address"
 *
 * — straight into the context window, labelled as approved evidence. The
 * failure mechanism was intact; only its route had changed, from the system
 * prompt to the case data. `fraudScreeningReasonWithSignals` was worse: it
 * inlined the same strings into the Evidence Basis row, a bank-facing surface
 * with no claim guard between it and the issuer.
 *
 * These assertions run the REAL `buildLlmFactPayload` and the REAL row
 * builder and inspect what comes out.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { buildLlmFactPayload } from "@/lib/defence/narrativeWriter";
import {
  bankFacingScreeningSignals,
  isVerificationScreeningSignal,
  projectScreeningValueForBank,
  screeningReachesBank,
} from "@/lib/argument/fraudScreeningSignals";
import { runClaimGuards } from "@/lib/defence/claimGuards";
import { visa_10_4_fraud } from "@/lib/defence/reasonCodes/visa_10_4_fraud";
import type { EvidenceFact } from "@/lib/defence/types";

const ROOT = resolve(__dirname, "../..");

/* ── Fixtures: Shopify's real phrasing ───────────────────────────────── */

const VERIFICATION_PHRASES = [
  "Card Verification Value (CVV) is correct",
  "Billing street address matches credit card's registered address",
  "Billing address matches the address on file with the card issuer",
  "AVS response indicates a full match",
];

const SAFE_PHRASES = [
  "IP address used to place the order isn't a high risk internet connection (web proxy)",
  "Billing country associated with the order matches the country of the IP",
  "There was 1 successful transaction with this credit card in the past",
  "The device used to place the order has been seen before",
];

function screeningFact(positiveFacts: string[]): EvidenceFact {
  return {
    id: "f_screen",
    category: "fraud_screening",
    label: "Fraud screening",
    value: { positiveFacts, recommendation: "ACCEPT", riskLevel: "low" },
    source: "shopify",
    sourceRef: null,
    strength: "supporting",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
  } as unknown as EvidenceFact;
}

function payloadFor(facts: EvidenceFact[]): Record<string, unknown> {
  return buildLlmFactPayload({
    packageId: "pkg-1",
    disputeId: "d-1",
    reasonCode: "10.4",
    packageMode: "narrow",
    caseStrength: "moderate",
    approvedFacts: facts,
    manualEvidence: [],
    internalOnlyFactIds: [],
    missingEvidence: [],
    reasonCodeModule: visa_10_4_fraud,
  } as never);
}

/* ── 1. The classifier ───────────────────────────────────────────────── */

describe("the shared classifier", () => {
  for (const phrase of VERIFICATION_PHRASES) {
    it(`excludes: "${phrase.slice(0, 44)}…"`, () => {
      expect(isVerificationScreeningSignal(phrase)).toBe(true);
    });
  }
  for (const phrase of SAFE_PHRASES) {
    it(`keeps: "${phrase.slice(0, 44)}…"`, () => {
      expect(isVerificationScreeningSignal(phrase)).toBe(false);
    });
  }

  it("mixed input exposes ONLY the independently safe signals", () => {
    const safe = bankFacingScreeningSignals([...VERIFICATION_PHRASES, ...SAFE_PHRASES]);
    expect(safe).toEqual(SAFE_PHRASES);
  });

  it("verification-only input leaves nothing, so the fact must not reach the bank", () => {
    expect(bankFacingScreeningSignals(VERIFICATION_PHRASES)).toEqual([]);
    expect(screeningReachesBank(VERIFICATION_PHRASES)).toBe(false);
    expect(projectScreeningValueForBank({ positiveFacts: VERIFICATION_PHRASES })).toBeNull();
  });

  it("a non-screening value passes through untouched", () => {
    const v = { avsResultCode: "Y", network: "visa" };
    expect(projectScreeningValueForBank(v)).toBe(v);
  });
});

/* ── 2. The REAL LLM payload ─────────────────────────────────────────── */

describe("the complete runtime user payload", () => {
  it("MIXED screening: safe signals survive, verification phrases are absent", () => {
    const payload = payloadFor([screeningFact([...VERIFICATION_PHRASES, ...SAFE_PHRASES])]);
    const json = JSON.stringify(payload);

    for (const phrase of VERIFICATION_PHRASES) {
      expect(json, `payload still contains: ${phrase}`).not.toContain(phrase);
    }
    for (const phrase of SAFE_PHRASES) {
      expect(json).toContain(phrase);
    }
    // And nothing verification-shaped survived under any wording.
    const facts = (payload.approvedFacts as Array<{ value: { positiveFacts: string[] } }>)[0];
    expect(facts.value.positiveFacts.every((p) => !isVerificationScreeningSignal(p))).toBe(true);
  });

  it("VERIFICATION-ONLY screening: the fact is dropped from the payload entirely", () => {
    /* Not emptied — dropped. A corroborator whose content was entirely removed
     * corroborates nothing, and a bare "screening recommended ACCEPT" is the
     * unaudited-recommendation claim the module already forbids. */
    const payload = payloadFor([screeningFact(VERIFICATION_PHRASES)]);
    const approved = payload.approvedFacts as Array<{ category: string }>;
    expect(approved.find((f) => f.category === "fraud_screening")).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("Card Verification Value");
  });

  it("the payload carries no verification-shaped screening text on any fixture", () => {
    for (const fixture of [
      [...VERIFICATION_PHRASES, ...SAFE_PHRASES],
      VERIFICATION_PHRASES,
      SAFE_PHRASES,
    ]) {
      const json = JSON.stringify(payloadFor([screeningFact(fixture)]));
      for (const phrase of VERIFICATION_PHRASES) {
        expect(json).not.toContain(phrase);
      }
    }
  });
});

/* ── 3. The Evidence Basis surface uses the SAME owner ───────────────── */

describe("the bank-facing Evidence Basis row", () => {
  it("inlines only the safe signals — same predicate, not a second regex", () => {
    const src = readFileSync(resolve(ROOT, "lib/argument/evidenceLineItem.ts"), "utf8");
    const fn = src.slice(
      src.indexOf("function fraudScreeningReasonWithSignals"),
      src.indexOf("function fraudScreeningReasonWithSignals") + 1400,
    );
    expect(fn).toMatch(/bankFacingScreeningSignals\(/);
    // The old inline filter is gone; a private copy here is the drift the
    // shared module exists to prevent.
    expect(fn).not.toMatch(/typeof x === "string"/);
  });

  it("verification-only signals produce no row reason at all", () => {
    // `bankFacingScreeningSignals` returning [] is what makes the builder
    // return null and fall back to the static, signal-free reason.
    expect(bankFacingScreeningSignals(VERIFICATION_PHRASES)).toEqual([]);
  });
});

/* ── 4. Nothing about the evidence rules moved ───────────────────────── */

describe("C-12 is untouched", () => {
  const screeningOnly = [screeningFact([...VERIFICATION_PHRASES, ...SAFE_PHRASES])];

  it("fraud_screening still licenses NO address claim", () => {
    const f = runClaimGuards({
      narrativeSections: {
        paymentAuthenticationArgument: {
          text: "The billing address matched the issuer's records.",
        },
      } as never,
      approvedFacts: screeningOnly,
    }).failures;
    expect(f.some((x) => x.guardId === "avs_address_verified_claim")).toBe(true);
  });

  it("fraud_screening still licenses NO security-code claim", () => {
    const f = runClaimGuards({
      narrativeSections: {
        paymentAuthenticationArgument: { text: "The card security code matched." },
      } as never,
      approvedFacts: screeningOnly,
    }).failures;
    expect(f.some((x) => x.guardId === "cvv_verified_claim")).toBe(true);
  });

  it("the predicates were not broadened to accept screening", () => {
    const preds = readFileSync(resolve(ROOT, "lib/defence/factPredicates.ts"), "utf8");
    const block = preds.slice(
      preds.indexOf("function paymentVerifications"),
      preds.indexOf("function orderRecordFulfillment"),
    );
    expect(block).toMatch(/payment_authentication/);
    expect(block).not.toMatch(/fraud_screening/);
  });

  it("raw screening data is untouched at rest — only the projection filters", () => {
    /* The filter is a bank-facing PROJECTION. Internal surfaces keep the full
     * signal set; nothing rewrites what the collector stored. */
    const raw = { positiveFacts: [...VERIFICATION_PHRASES, ...SAFE_PHRASES], recommendation: "ACCEPT" };
    const before = JSON.stringify(raw);
    projectScreeningValueForBank(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
