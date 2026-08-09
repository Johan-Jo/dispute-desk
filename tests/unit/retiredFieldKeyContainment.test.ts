/**
 * PR-C4 (C-14) — `billing_address_match` retirement boundary.
 *
 * The field was graded **strong** on the registry promise "Strong when
 * AVS-confirmed billing matches the cardholder", and emitted whenever
 * Shopify's own billing and shipping addresses shared a city and a country —
 * two merchant-held addresses, no AVS result, no cardholder.
 *
 * Historical `pack_json` and historical `checklist_v2` must still parse. What
 * must NOT happen is the retired key producing an evidence record, a fact
 * category, a grade, a completeness credit, a citation, an LLM value, or a
 * claim authority — on ANY path, from ANY payload, including the
 * `match: true` production never actually wrote.
 *
 * Every assertion below is on the FACT layer, never on generated prose.
 */

import { describe, expect, it } from "vitest";
import {
  RETIRED_FIELD_KEYS,
  isRetiredFieldKey,
  retiredFieldKeysIn,
  withoutRetiredFieldKeys,
} from "@/lib/evidence/model/retiredKeys";
import {
  CANONICAL_DOMAIN,
  EVIDENCE_FIELD_KEYS,
  domainOf,
  isEvidenceField,
  retiredFieldKeysInEvidenceDomain,
} from "@/lib/evidence/model/domains";
import { EVIDENCE_DEFINITIONS } from "@/lib/evidence/model/definitions";
import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";
import { normalizeEvidencePayload } from "@/lib/evidence/model/payloads";
import {
  CANONICAL_EVIDENCE,
  categorizeEvidenceField,
  getCanonicalSpec,
} from "@/lib/argument/canonicalEvidence";
import {
  REASON_TEMPLATES,
  REASON_TEMPLATES_V2,
  deriveCompletenessMetrics,
  type ChecklistItemV2,
} from "@/lib/automation/completeness";
import { reconcileChecklistWithCollectedFields } from "@/lib/packs/checklistReconcile";
import {
  classifyFacts,
  isFieldBankEligible,
  type ClassifyFactsInput,
  type PackSectionLike,
} from "@/lib/defence/factClassifier";
import { resolveReasonCodeModule } from "@/lib/defence/reasonCodes/registry";
import { evaluateAllPredicates } from "@/lib/defence/factPredicates";
import { deriveClaimCapabilities } from "@/lib/defence/claimCapabilities";
import { buildInternalSignalsByField } from "@/lib/argument/internalSignals";
import en from "@/messages/en.json";
import de from "@/messages/de.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";
import pt from "@/messages/pt.json";
import sv from "@/messages/sv.json";

const RETIRED = "billing_address_match";

/**
 * A faithful copy of a historical order section — the shape prod actually
 * holds (116 packs at the 2026-08-09 census: the field in `fieldsProvided`,
 * no `match` key anywhere).
 */
const HISTORICAL_SECTION = {
  source: "shopify_order",
  fieldsProvided: ["order_confirmation", RETIRED],
  data: {
    orderId: "gid://shopify/Order/1",
    orderName: "#1001",
    billingAddress: { city: "Stockholm", provinceCode: null, countryCode: "SE", zipPrefix: "113" },
    shippingAddress: { city: "Stockholm", provinceCode: null, countryCode: "SE", zipPrefix: "113" },
  },
};

/** The same section with the `match: true` flag the grader keyed on. Prod
 *  never wrote it — a single collector line would have. Every assertion below
 *  runs against BOTH shapes, so the containment does not depend on the
 *  historical data happening to be harmless. */
const HOSTILE_SECTION = {
  ...HISTORICAL_SECTION,
  data: { ...HISTORICAL_SECTION.data, match: true },
};

const BOTH = [
  ["historical (no `match` key)", HISTORICAL_SECTION],
  ["hostile (`match: true`)", HOSTILE_SECTION],
] as const;

/* ── 1. The registry itself ───────────────────────────────────────────── */

describe("the retired-field registry", () => {
  it("names billing_address_match", () => {
    expect([...RETIRED_FIELD_KEYS]).toEqual([RETIRED]);
    expect(isRetiredFieldKey(RETIRED)).toBe(true);
    expect(isRetiredFieldKey("avs_cvv_match")).toBe(false);
  });

  it("reports and strips retired keys from a field list", () => {
    expect(retiredFieldKeysIn(["order_confirmation", RETIRED])).toEqual([RETIRED]);
    expect(retiredFieldKeysIn(["order_confirmation"])).toEqual([]);
    expect(withoutRetiredFieldKeys(["order_confirmation", RETIRED])).toEqual([
      "order_confirmation",
    ]);
  });

  it("keeps the same reference when nothing is retired", () => {
    const clean = ["order_confirmation", "avs_cvv_match"];
    expect(withoutRetiredFieldKeys(clean)).toBe(clean);
  });

  it("is registered as `operational` — reported, never an accident", () => {
    // Deleting the key from CANONICAL_DOMAIN would file it under
    // `unregisteredFields`, which reads as a bug rather than a decision.
    expect(CANONICAL_DOMAIN[RETIRED]).toBe("operational");
    expect(domainOf(RETIRED)).toBe("operational");
    expect(retiredFieldKeysInEvidenceDomain()).toEqual([]);
  });

  it("has no evidence identity left anywhere", () => {
    expect(isEvidenceField(RETIRED)).toBe(false);
    expect(EVIDENCE_FIELD_KEYS).not.toContain(RETIRED);
    expect(getCanonicalSpec(RETIRED)).toBeNull();
    expect(CANONICAL_EVIDENCE[RETIRED]).toBeUndefined();
    expect(Object.keys(EVIDENCE_DEFINITIONS)).not.toContain(RETIRED);
    expect(normalizeEvidencePayload(RETIRED as never, HOSTILE_SECTION.data)).toBeNull();
  });

  it("is absent from every completeness template, v1 and v2", () => {
    for (const [reason, template] of Object.entries(REASON_TEMPLATES)) {
      expect(template.map((t) => t.field), `v1 ${reason}`).not.toContain(RETIRED);
    }
    for (const [reason, template] of Object.entries(REASON_TEMPLATES_V2)) {
      expect(template.map((t) => t.field), `v2 ${reason}`).not.toContain(RETIRED);
    }
  });
});

/* ── 2. No grade ──────────────────────────────────────────────────────── */

describe("no grade", () => {
  for (const payload of [
    { match: true },
    { match: false },
    { match: true, avsResultCode: "Y", cvvResultCode: "M" },
    {},
    null,
  ]) {
    it(`categorizeEvidenceField is invalid for ${JSON.stringify(payload)}`, () => {
      expect(categorizeEvidenceField(RETIRED, payload)).toBe("invalid");
    });
  }
});

/* ── 3. No record, and reported as retired ────────────────────────────── */

describe("no record — and the key is reported, never dropped", () => {
  for (const [name, section] of BOTH) {
    it(`derives no record from the ${name} section`, () => {
      const { model } = deriveCaseEvidenceModel({
        disputeId: "d1",
        reason: "FRAUDULENT",
        sections: [section],
      });

      expect(Object.keys(model.fields)).not.toContain(RETIRED);
      const everyRecord = Object.values(model.fields).flatMap((f) => f.records);
      // `String(...)` because `EvidenceFieldKey` no longer includes the retired
      // key at all — the compiler calls the comparison unreachable, which is
      // itself half the guarantee. The runtime assertion is the other half.
      expect(everyRecord.some((r) => String(r.fieldKey) === RETIRED)).toBe(false);
      expect(everyRecord.some((r) => r.recordId.includes(RETIRED))).toBe(false);

      // Reported here and NOWHERE else in the model.
      expect(model.nonEvidence.operational.retiredFields).toContain(RETIRED);
      expect(model.nonEvidence.operational.unregisteredFields).not.toContain(RETIRED);

      // The order row it shared a section with is untouched — the retirement
      // removes a field, not a section.
      expect(model.fields.order_confirmation.records.length).toBe(1);
    });
  }

  it("reports the key when it arrives on an evidence_item payload too", () => {
    const { model } = deriveCaseEvidenceModel({
      disputeId: "d1",
      reason: "FRAUDULENT",
      evidenceItems: [
        { id: "ei1", source: "shopify_order", payload: { fieldsProvided: [RETIRED], match: true } },
      ],
    });
    expect(model.nonEvidence.operational.retiredFields).toContain(RETIRED);
    expect(Object.keys(model.fields)).not.toContain(RETIRED);
  });
});

/* ── 4. No completeness credit ────────────────────────────────────────── */

describe("no completeness credit", () => {
  const row = (field: string, status: ChecklistItemV2["status"]): ChecklistItemV2 => ({
    field,
    label: field,
    status,
    priority: "critical",
    blocking: false,
    source: "auto_shopify",
  });

  for (const status of ["available", "missing", "unavailable", "waived"] as const) {
    it(`drops a persisted ${status} row at the reconcile boundary`, () => {
      const out = reconcileChecklistWithCollectedFields(
        [row("order_confirmation", "available"), row(RETIRED, status)],
        new Set(["order_confirmation", RETIRED]),
      );
      expect(out.map((c) => c.field)).toEqual(["order_confirmation"]);
    });
  }

  it("never re-appends the field even though it is still collected", () => {
    // The append rule adds collected canonical fields with no template row.
    // It iterates EVIDENCE_FIELD_KEYS, which the retired key has left.
    const out = reconcileChecklistWithCollectedFields([], new Set([RETIRED]));
    expect(out).toEqual([]);
  });

  it("scores identically to a checklist that never had the row", () => {
    const withRow = [row("order_confirmation", "available"), row(RETIRED, "available")];
    const withoutRow = [row("order_confirmation", "available")];
    const collected = new Set(["order_confirmation", RETIRED]);
    expect(
      deriveCompletenessMetrics(reconcileChecklistWithCollectedFields(withRow, collected)),
    ).toEqual(
      deriveCompletenessMetrics(reconcileChecklistWithCollectedFields(withoutRow, collected)),
    );
  });
});

/* ── 5. No citation, no LLM value, no claim authority ─────────────────── */

function classifyInput(overrides: Partial<ClassifyFactsInput> = {}): ClassifyFactsInput {
  return {
    packageId: "pkg0",
    sections: [],
    evidenceItems: [],
    checklist: [],
    coverage: { state: "not_covered" },
    fatalLoss: { triggered: false, reason: null },
    caseStrength: "moderate",
    manualRows: [],
    reasonCodeModule: resolveReasonCodeModule("10.4"),
    ...overrides,
  };
}

describe("no citation, no LLM value", () => {
  for (const [name, section] of BOTH) {
    it(`produces no fact at all from the ${name} section`, () => {
      const result = classifyFacts(
        classifyInput({ sections: [section as unknown as PackSectionLike] }),
      );
      const all = [...result.approved, ...result.internalOnly, ...result.submissionRisk];

      expect(all.some((f) => f.value.fieldKey === RETIRED)).toBe(false);
      expect(all.some((f) => f.category === "billing_match")).toBe(false);
      // Nothing carries the retired identity into the LLM payload, which is
      // built from these facts.
      expect(JSON.stringify(all)).not.toContain(RETIRED);
      expect(JSON.stringify(all)).not.toContain("billing_match");

      // The order fact it shared a section with still exists.
      expect(all.some((f) => f.category === "order_record")).toBe(true);
    });
  }

  it("is never bank-eligible, whatever the payload says", () => {
    expect(isFieldBankEligible(RETIRED, { match: true })).toBe(false);
    expect(isFieldBankEligible(RETIRED, { match: true, avsResultCode: "Y" })).toBe(false);
  });

  it("produces no missing-evidence row from a historical checklist", () => {
    const result = classifyFacts(
      classifyInput({
        checklist: [
          {
            field: RETIRED,
            label: "Billing Address Match",
            status: "missing",
            priority: "critical",
            blocking: false,
            source: "auto_shopify",
          } as never,
        ],
      }),
    );
    expect(result.missing.some((m) => m.category === "billing_match")).toBe(false);
    expect(JSON.stringify(result.missing)).not.toContain("Billing address match");
  });
});

describe("no claim authority", () => {
  it("the billing_match_confirmed predicate cannot fire off classified facts", () => {
    const result = classifyFacts(
      classifyInput({ sections: [HOSTILE_SECTION as unknown as PackSectionLike] }),
    );
    expect(result.predicateEvaluations.billing_match_confirmed).toBe(false);
    // …and on the raw approved set, evaluated independently.
    expect(evaluateAllPredicates(result.approved).billing_match_confirmed).toBe(false);
  });

  it("grants no claim capability, even from a hand-built strong billing fact", () => {
    // Deletion criterion 3, adversarially: the fact the classifier can no
    // longer build, handed to the capability deriver anyway.
    const caps = deriveClaimCapabilities([
      {
        id: "probe",
        category: "billing_match",
        label: "Billing address match",
        value: { match: true, fieldKey: RETIRED, deliveredToVerifiedAddress: true },
        source: "shopify_order",
        sourceRef: null,
        strength: "strong",
        bankEligible: true,
        merchantVisible: true,
        internalOnly: false,
        includeInBankNarrative: true,
        submissionRisk: false,
        confidence: null,
      },
    ]);
    expect([...caps]).toEqual([]);
  });
});

/* ── 6. The operational note survives, under its own label ────────────── */

describe("the billing-vs-shipping comparison survives as a NON-EVIDENCE note", () => {
  const payloads = (billingCity: string, shippingCity: string) =>
    new Map<string, unknown>([
      [
        "order_confirmation",
        {
          billingAddress: { city: billingCity, countryCode: "SE" },
          shippingAddress: { city: shippingCity, countryCode: "SE" },
        },
      ],
    ]);

  it("emits the agreement note when city + country agree", () => {
    const signals = buildInternalSignalsByField(payloads("Stockholm", "Stockholm"));
    const note = signals.get("order_confirmation")?.find(
      (s) => s.id === "internal:billing_shipping_agree",
    );
    expect(note).toBeDefined();
    expect(note?.severity).toBe("info");
    // It names the merchant's own order record and says what it is NOT.
    expect(note?.reason).toMatch(/not evidence/i);
    expect(note?.reason).toMatch(/never scored/i);
    // It never borrows the retired field's vocabulary.
    expect(note?.label).not.toMatch(/cardholder|AVS/i);
  });

  it("still emits the mismatch note when they differ, and not the agreement one", () => {
    const signals = buildInternalSignalsByField(payloads("Stockholm", "Malmö"));
    const ids = (signals.get("order_confirmation") ?? []).map((s) => s.id);
    expect(ids).toContain("internal:billing_address_mismatch");
    expect(ids).not.toContain("internal:billing_shipping_agree");
  });
});

/* ── 7. Copy: the misleading label is retired, the new one ships ×6 ───── */

describe("locale copy", () => {
  const locales = { en, de, es, fr, pt, sv } as Record<
    string,
    {
      disputes: {
        signalLabel: Record<string, string>;
        whyText: Record<string, string>;
        sourceCaption: Record<string, string>;
        internalSignals: Record<string, { title?: string; explanation?: string }>;
      };
    }
  >;

  for (const [name, messages] of Object.entries(locales)) {
    it(`${name}: the evidence label is retired, not repurposed`, () => {
      const d = messages.disputes;
      expect(d.signalLabel.billing_match).toBeUndefined();
      expect(d.whyText[RETIRED]).toBeUndefined();
      expect(d.sourceCaption[RETIRED]).toBeUndefined();
    });

    it(`${name}: the operational note ships under a NEW key`, () => {
      const note = messages.disputes.internalSignals.billingShippingAgree;
      expect(note?.title, `${name} title`).toBeTruthy();
      expect(note?.explanation, `${name} explanation`).toBeTruthy();
      // The mismatch note is untouched by this PR.
      expect(messages.disputes.internalSignals.billingAddress?.title).toBeTruthy();
    });
  }
});
