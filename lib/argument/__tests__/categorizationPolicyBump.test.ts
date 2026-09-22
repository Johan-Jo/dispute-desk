/**
 * THE MECHANISED FORM OF THE BUMP RULE.
 *
 * `assessment.ts` has said since v2:
 *
 *   "changing what `categorizeEvidenceField` returns for any field is a policy
 *    change and MUST bump `SCORING_POLICY_VERSION` in the same PR"
 *
 * It said it in a comment, and a rule that lives only in prose is violated by
 * the next person who does not read the prose. That is not hypothetical: the
 * `ip_location_check` same_country fix sat on a branch for three weeks with the
 * categorization changed and the constant untouched — carrying exactly the
 * defect the comment warns about, into the release that would have shipped it.
 *
 * ── WHAT THIS PINS, AND WHY IT IS A SNAPSHOT AND NOT A LIST OF RULES ──
 *
 * The table below is the OBSERVED output of `categorizeEvidenceField` over a
 * representative payload per branch. It is deliberately NOT a restatement of
 * the categorizer's logic: a test that re-implements the rules passes whenever
 * the copy is updated alongside them, which is the failure mode of every
 * "assert the source mentions X" test this repo has already been burned by.
 *
 * So the assertion is: these inputs produce these categories, AND the policy
 * version is this number. Change a category and the test fails with a diff of
 * what moved. The fix is to bump `SCORING_POLICY_VERSION` and update the
 * snapshot in the same commit — which is precisely the rule, now enforced.
 *
 * ── WHY THE VERSION IS ASSERTED IN THE SAME TEST ──────────────────────
 *
 * Two separate tests — one pinning categories, one pinning the constant —
 * would both pass if someone changed a category and bumped the version for an
 * unrelated reason, or bumped the version and changed a category in the other
 * direction. Pairing them in one snapshot makes the coupling the thing under
 * test, rather than two facts that happen to be true.
 */

import { describe, it, expect } from "vitest";
import { categorizeEvidenceField } from "../canonicalEvidence";
import { SCORING_POLICY_VERSION } from "@/lib/evidence/model/assessment";

/**
 * One representative payload per decision branch of `categorizeEvidenceField`.
 *
 * Keyed by a human label rather than fieldKey alone, because several fields
 * have multiple branches and a bare fieldKey could not distinguish them. The
 * label is what a failure message shows, so it names the CASE, not the field.
 */
const CASES: ReadonlyArray<{
  label: string;
  fieldKey: string;
  payload: Record<string, unknown> | null;
}> = [
  // ── delivery_proof / shipping_tracking ──
  { label: "delivery: signature_confirmed", fieldKey: "delivery_proof", payload: { proofType: "signature_confirmed" } },
  { label: "delivery: delivered_confirmed", fieldKey: "delivery_proof", payload: { proofType: "delivered_confirmed" } },
  { label: "delivery: delivered_unverified", fieldKey: "delivery_proof", payload: { proofType: "delivered_unverified" } },
  { label: "delivery: returned_to_sender", fieldKey: "delivery_proof", payload: { proofType: "returned_to_sender" } },
  { label: "delivery: label_created", fieldKey: "delivery_proof", payload: { proofType: "label_created" } },
  { label: "delivery: manual upload, no proofType", fieldKey: "delivery_proof", payload: { fileName: "pod.pdf" } },
  { label: "shipping_tracking: delivered_confirmed", fieldKey: "shipping_tracking", payload: { proofType: "delivered_confirmed" } },

  // ── tds_authentication ──
  { label: "3DS: merchant-confirmed", fieldKey: "tds_authentication", payload: { tdsVerified: true } },
  { label: "3DS: shopify receipt read", fieldKey: "tds_authentication", payload: { tdsAuthenticated: true, verifiedSource: "shopify_receipt" } },
  { label: "3DS: absent", fieldKey: "tds_authentication", payload: {} },

  /* ── ip_location_check — THE FIELD THIS BUMP IS ABOUT ────────────────
   *
   * `bankEligible` is the collector's gate. When it is false the row must stay
   * `supporting` whatever the match says, so an adverse payload can never
   * become citable; that pairing is asserted explicitly below rather than left
   * to the same_country case to imply. */
  { label: "ip: same_city, gate passed", fieldKey: "ip_location_check", payload: { bankEligible: true, locationMatch: "same_city" } },
  { label: "ip: same_country, gate passed", fieldKey: "ip_location_check", payload: { bankEligible: true, locationMatch: "same_country" } },
  { label: "ip: same_country, gate FAILED", fieldKey: "ip_location_check", payload: { bankEligible: false, locationMatch: "same_country" } },
  { label: "ip: different_country", fieldKey: "ip_location_check", payload: { bankEligible: true, locationMatch: "different_country" } },

  // ── absent / unknown ──
  { label: "unknown field", fieldKey: "not_a_real_field", payload: {} },
  { label: "delivery: null payload", fieldKey: "delivery_proof", payload: null },
];

/**
 * THE SNAPSHOT. Update this ONLY together with `SCORING_POLICY_VERSION`.
 *
 * A category here changing without the version below changing is the exact
 * defect this file exists to catch.
 */
const EXPECTED: Record<string, string> = {
  "delivery: signature_confirmed": "strong",
  "delivery: delivered_confirmed": "moderate",
  "delivery: delivered_unverified": "supporting",
  "delivery: returned_to_sender": "invalid",
  "delivery: label_created": "invalid",
  "delivery: manual upload, no proofType": "supporting",
  "shipping_tracking: delivered_confirmed": "moderate",

  "3DS: merchant-confirmed": "strong",
  "3DS: shopify receipt read": "moderate",
  "3DS: absent": "invalid",

  "ip: same_city, gate passed": "moderate",
  // v3: was `supporting` through v2. `supporting` is the tier that makes a
  // fact NOT bank-eligible, so the row was excluded from the Evidence Basis
  // while the collector emitted an approved bank sentence asserting it.
  "ip: same_country, gate passed": "moderate",
  "ip: same_country, gate FAILED": "supporting",
  "ip: different_country": "supporting",

  "unknown field": "invalid",
  "delivery: null payload": "invalid",
};

/** The version the snapshot above describes. */
const SNAPSHOT_POLICY_VERSION = 3;

describe("categorization is pinned to the scoring policy version", () => {
  it("every pinned case still categorizes as the snapshot says", () => {
    const actual: Record<string, string> = {};
    for (const c of CASES) {
      actual[c.label] = categorizeEvidenceField(c.fieldKey, c.payload);
    }
    /* Whole-object comparison, not a per-case loop: the failure output then
     * shows EVERY category that moved in one diff, which is what a reader
     * needs to decide whether a bump is warranted. A loop of individual
     * assertions stops at the first one. */
    expect(actual).toEqual(EXPECTED);
  });

  it("the live policy version matches the version this snapshot describes", () => {
    /* If this fails, someone changed `SCORING_POLICY_VERSION` without
     * revisiting the categorization snapshot. Confirm whether any category
     * actually moved, then update `SNAPSHOT_POLICY_VERSION` to match. */
    expect(SCORING_POLICY_VERSION).toBe(SNAPSHOT_POLICY_VERSION);
  });
});
