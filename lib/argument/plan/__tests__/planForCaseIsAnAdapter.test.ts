/**
 * `derivePlanForCase` adapts canonical output. It does not classify.
 *
 * ── THE RISK THIS GUARDS ──────────────────────────────────────────────
 *
 * The module sits between `pack_json.sections` and `CaseArgumentPlan`, which
 * is precisely where a second evidence-classification layer would grow if one
 * were going to. It would not announce itself: it would arrive as one
 * reasonable-looking line — "skip records whose payload is empty", "treat a
 * `shopify_timeline` source as weaker", "only bank-eligible facts become
 * candidates" — and from then on the answer to "is this evidence usable" would
 * depend on which of two modules you asked.
 *
 * That is not hypothetical for this codebase. The 2026-08-03 audit found seven
 * mutually incompatible strength vocabularies, and C-1 found the bank-inclusion
 * rule spelled four times with one of the four weaker than the others — each of
 * them originally a reasonable-looking line at a boundary.
 *
 * ── WHAT "ADAPTER" MEANS, PRECISELY ───────────────────────────────────
 *
 * Every classification-bearing value in the plan is CARRIED from a canonical
 * owner, never computed here:
 *
 *   availability / existence   `deriveCaseEvidenceModel` — which records exist
 *   validity                   `record.validity.state`, carried verbatim
 *   citation eligibility       `record.citation.eligibility`, carried verbatim
 *   fact category              `definitionFor(fieldKey).factCategory`
 *   bank eligibility           `classifyFacts` (the caller's `approvedFacts`)
 *   claim authority            `alwaysAdmissibleCategories`
 *   argument relevance         `reasonCodeModule.allowedFactCategories`
 *   which of those excludes    `deriveCaseArgumentPlan`, the one derivation
 *
 * The module's own contribution is plumbing: call the owners, hash the inputs,
 * and build a record-id → fact map. Nothing in it may branch on what a fact
 * MEANS.
 *
 * ── WHY A SOURCE-LEVEL TEST HERE ──────────────────────────────────────
 *
 * Behaviour tests prove what the module does on the fixtures it is given; they
 * cannot prove the absence of a rule that no fixture triggers. A dependency and
 * contract check can. It is paired with a falsification guard below — the same
 * detectors are re-run against a deliberately-classifying module — because a
 * scan that cannot fail is decoration.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  planCandidatesFromModel,
  derivePlanForCase,
} from "@/lib/argument/plan";
import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";
import type { ReasonCodeGuidance } from "@/lib/defence/types";

const ROOT = resolve(__dirname, "../../../..");
const SOURCE = readFileSync(
  resolve(ROOT, "lib/argument/plan/planForCase.ts"),
  "utf8",
);
const CANDIDATES_SOURCE = readFileSync(
  resolve(ROOT, "lib/argument/plan/candidates.ts"),
  "utf8",
);

/** Comments are prose about the rule, not the rule. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * Vocabulary that only appears when a module is DECIDING evidentiary meaning.
 *
 * Each entry is a value from a canonical vocabulary (`ValidityState`,
 * `CitationEligibility`, `EvidenceQuality`) or a classification flag. Reading
 * one is fine — carrying `record.validity.state` is the whole job — so the
 * detector looks for a COMPARISON against one, which is what a decision looks
 * like.
 */
const DECISION_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "validity comparison", pattern: /["'](valid|invalid|unverifiable)["']/ },
  {
    name: "citation-eligibility comparison",
    pattern: /["'](eligible|ineligible|withheld_internal|withheld_risk)["']/,
  },
  {
    name: "quality comparison",
    pattern: /["'](decisive|corroborating|contextual)["']/,
  },
  { name: "bank-eligibility flag", pattern: /\bbankEligible\b/ },
  { name: "bank-narrative flag", pattern: /\bincludeInBankNarrative\b/ },
  { name: "submission-risk flag", pattern: /\bsubmissionRisk\b/ },
  { name: "package-inclusion flag", pattern: /\bincludeInPackage\b/ },
  { name: "checklist status", pattern: /["'](available|waived|missing|not_applicable)["']/ },
  { name: "numeric threshold", pattern: /[<>]=?\s*\d+/ },
];

describe("derivePlanForCase is an adapter, not a classifier", () => {
  for (const { name, pattern } of DECISION_PATTERNS) {
    it(`contains no ${name}`, () => {
      expect(pattern.test(code(SOURCE)), `planForCase.ts: ${name}`).toBe(false);
      expect(pattern.test(code(CANDIDATES_SOURCE)), `candidates.ts: ${name}`).toBe(false);
    });
  }

  it("guard the guard — the detectors fire on a module that DOES classify", () => {
    /* Without this, a rename in the vocabulary would silently disarm every
     * assertion above and they would all keep passing. The counter-example is
     * a plausible one: it looks like a helpful narrowing, and it is exactly the
     * shape that would be written. */
    const classifying = `
      export function planCandidates(model) {
        return records
          .filter((r) => r.validity.state === "valid")
          .filter((r) => r.citation.eligibility !== "withheld_risk")
          .filter((f) => f.bankEligible && f.includeInBankNarrative)
          .filter((r) => r.confidence >= 70);
      }
    `;
    const fired = DECISION_PATTERNS.filter((d) => d.pattern.test(classifying));
    expect(fired.map((d) => d.name)).toEqual([
      "validity comparison",
      "citation-eligibility comparison",
      "bank-eligibility flag",
      "bank-narrative flag",
      "numeric threshold",
    ]);
  });

  it("imports only canonical owners — no private classification helper", () => {
    /* An adapter's import list IS its contract: every classification it needs
     * has to arrive from a named owner. A helper imported from anywhere else,
     * or defined locally with a classifying name, is the second layer. */
    const imports = [
      ...new Set(
        [...code(SOURCE).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]),
      ),
    ].sort();
    expect(imports).toEqual(
      [
        // The plan's own pieces.
        "./candidates",
        "./deriveArgumentPlan",
        "./planInputHash",
        // The canonical owners, one per classification the plan consumes.
        "@/lib/defence/alwaysAdmissible", // claim admission
        "@/lib/defence/types", // types only
        "@/lib/evidence/model/derive", // existence, validity, citation
        "@/lib/pipeline/contracts", // types only
      ].sort(),
    );
  });

  it("reads a fact only for its fieldKey — never for a property that grades it", () => {
    /* The one place the module touches an `EvidenceFact` is to find which
     * record it belongs to. If it ever reaches for `strength`, `category`,
     * `confidence` or a flag, it has started forming an opinion. */
    const factReads = [...code(SOURCE).matchAll(/fact\.(\w+)|f\.(\w+)/g)]
      .map((m) => m[1] ?? m[2])
      .filter((k) => k !== "value");
    expect([...new Set(factReads)]).toEqual([]);
    expect(code(SOURCE)).toContain("value as { fieldKey?: unknown }");
  });
});

describe("every classification in the plan is CARRIED, not computed", () => {
  /**
   * The behavioural half. The source scan proves no rule is written here; this
   * proves the values that arrive are byte-identical to the canonical owner's,
   * so "carried" is not just an absence of code.
   */
  const SECTIONS = [
    {
      type: "fulfillment",
      label: "Delivery confirmation",
      source: "shopify_fulfillments",
      fieldsProvided: ["delivery_proof"],
      data: {
        proofType: "delivered_confirmed",
        carrier: "PostNord",
        trackingNumber: "1",
        deliveredAt: "2026-05-12T10:00:00.000Z",
        fulfillmentId: "gid://shopify/Fulfillment/1",
      },
    },
  ];

  const MODEL_INPUT = {
    disputeId: "case-1",
    reason: "fraudulent",
    packId: "pack-1",
    sections: SECTIONS,
    evidenceItems: [],
  };

  it("candidate validity and citation come verbatim from the evidence model", () => {
    const { model } = deriveCaseEvidenceModel(MODEL_INPUT);
    const candidates = planCandidatesFromModel(model);
    const byRecord = new Map(candidates.map((c) => [c.recordId, c]));

    let compared = 0;
    for (const summary of Object.values(model.fields)) {
      for (const record of summary.records) {
        const candidate = byRecord.get(record.recordId);
        expect(candidate, `no candidate for ${record.recordId}`).toBeDefined();
        expect(candidate!.validity).toBe(record.validity.state);
        expect(candidate!.citation).toBe(record.citation.eligibility);
        expect(candidate!.fieldKey).toBe(summary.fieldKey);
        compared += 1;
      }
    }
    // Guard the guard: an empty model would satisfy the loop vacuously.
    expect(compared).toBeGreaterThan(0);
  });

  it("the plan admits exactly the module's allow-list, never a narrower one", () => {
    /* If the adapter had an opinion, the simplest place to express it would be
     * dropping a candidate the module allows. So: widen the allow-list to
     * everything and assert nothing is excluded for relevance. Any exclusion
     * that survives came from validity or citation — the canonical owners —
     * never from this module. */
    const permissive = derivePlanForCase({
      caseId: "case-1",
      model: MODEL_INPUT,
      reasonCodeModule: {
        key: "generic_fallback" as ReasonCodeGuidance["key"],
        allowedFactCategories: [
          ...new Set(
            planCandidatesFromModel(deriveCaseEvidenceModel(MODEL_INPUT).model).map(
              (c) => c.factCategory,
            ),
          ),
        ] as ReasonCodeGuidance["allowedFactCategories"],
        criticalCategories: [] as ReasonCodeGuidance["criticalCategories"],
      },
      approvedFacts: [],
      computedAt: "2026-08-10T00:00:00.000Z",
    });
    expect(
      permissive.plan.excluded.filter((e) => e.reason === "not_argument_relevant"),
    ).toEqual([]);
  });

  it("is deterministic — the same persisted inputs give the same hash", () => {
    const args = {
      caseId: "case-1",
      model: MODEL_INPUT,
      reasonCodeModule: {
        key: "generic_fallback" as ReasonCodeGuidance["key"],
        allowedFactCategories: ["delivery"] as ReasonCodeGuidance["allowedFactCategories"],
        criticalCategories: [] as ReasonCodeGuidance["criticalCategories"],
      },
      approvedFacts: [],
      computedAt: "2026-08-10T00:00:00.000Z",
    } as const;
    const a = derivePlanForCase({ ...args });
    const b = derivePlanForCase({ ...args, computedAt: "2027-01-01T00:00:00.000Z" });
    // `computedAt` is audit-only and must not move the hash — otherwise every
    // package reads stale the moment it is re-derived.
    expect(a.planInputHash).toBe(b.planInputHash);
  });
});
