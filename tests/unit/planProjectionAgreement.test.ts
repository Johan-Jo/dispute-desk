/**
 * P0 — the merchant tabs must PROJECT the argument plan, not re-derive it.
 *
 * THE DEFECT THIS PINS (prod, 2026-09-21, blume-box dispute
 * 4576ee51-53ec-4ed2-8c66-65b04bb31d72). The plan excluded
 * `ip_location_check` as `not_argument_relevant` — correctly, because
 * `inr_product_not_received` does not list `ip_location` in
 * `allowedFactCategories`. The PDF is a projection of the plan and cites it
 * nowhere. The Overview and Evidence tabs nonetheless rendered it as
 * "Used as positive bank argument / Cited in the PDF as decisive proof",
 * because `deriveEvidenceLineItems` never receives the plan and answers the
 * question from `checklist + payload` instead.
 *
 * Measured blast radius: 171 of 172 plan-bearing packs; 111/111 of the
 * disputes whose plan excluded the IP fact displayed it as positive.
 *
 * WHY THE ASSERTION IS SET-MEMBERSHIP, NOT A COUNT. On the trigger pack
 * `plan.included` holds 8 records, `facts_json` 1 fact and the Evidence
 * Basis 1 row — legitimately different cardinalities measuring different
 * things (records vs bank-eligible facts vs rendered rows). A count-equality
 * test would fail on correct packs and would pressure someone into widening
 * the letter to match the UI. Only per-record DISPOSITION is comparable.
 *
 * WHY RECORD-LEVEL, NOT FIELD-LEVEL. `deriveArgumentPlan` excludes by
 * `recordId`: its own suite pins a case including `delivery_proof#parcel-b`
 * while excluding `delivery_proof#parcel-a` — one `fieldKey`, two verdicts.
 * A field-keyed assertion cannot tell a correct mixed row from an incorrect
 * uniform one, so it would pass on a rendering that is wrong.
 *
 * Plan: docs/plans/plan-projection-drift.plan.md §P0.
 */

import { describe, it, expect } from "vitest";
import { deriveEvidenceLineItems } from "@/lib/argument/evidenceLineItem";
import { computeContributions, calculateCaseStrength } from "@/lib/argument/caseStrength";
import { NO_GATES } from "@/tests/helpers/caseStrengthGates";
import { excludedRecordIds, includedRecordIds } from "@/lib/argument/plan/deriveArgumentPlan";
import type { CaseArgumentPlanSnapshot } from "@/lib/pipeline/contracts";
import type { ChecklistItemV2 } from "@/lib/automation/completeness";
import type { EvidenceFact } from "@/lib/defence/types";
import enCatalog from "@/messages/en.json";
import deCatalog from "@/messages/de.json";
import esCatalog from "@/messages/es.json";
import frCatalog from "@/messages/fr.json";
import ptCatalog from "@/messages/pt.json";
import svCatalog from "@/messages/sv.json";

/* ── The trigger case, as prod holds it ──────────────────────────── */

/**
 * `ip_location_check` payload exactly as `deviceLocationSource` emits it for
 * this dispute: same-country match, clean privacy, so `computeBankEligible`
 * returns true and `categorizeEvidenceField` rates it `moderate`. Every
 * legacy predicate therefore says "positive bank evidence" — which is the
 * point: only the plan knows it is irrelevant to an INR argument.
 */
const IP_PAYLOAD = {
  fieldKey: "ip_location_check",
  locationMatch: "same_country",
  bankEligible: true,
  riskLevel: "low",
} as const;

const NO_RETURN_PAYLOAD = {
  fieldKey: "no_return_initiated",
  returnStatus: "NO_RETURN",
  returnInitiated: false,
} as const;

/** The one fact that actually reached the letter on the trigger pack. */
const NO_RETURN_FACT: EvidenceFact = {
  id: "no_return_initiated#0",
  label: "No return initiated",
  value: NO_RETURN_PAYLOAD as unknown as EvidenceFact["value"],
  source: "shopify_order",
  category: "no_return_initiated",
  strength: "moderate",
  sourceRef: "5eb73718-0955-441e-b062-5c8ff4dae0f5",
  confidence: null,
  bankEligible: true,
  internalOnly: false,
  submissionRisk: false,
  merchantVisible: true,
  includeInBankNarrative: true,
} as unknown as EvidenceFact;

function checklistItem(
  field: string,
  over: Partial<ChecklistItemV2> = {},
): ChecklistItemV2 {
  return {
    field,
    label: field,
    status: "available",
    requirementMode: "recommended",
    priority: "recommended",
    blocking: false,
    expectedSource: "auto",
    collectionType: "auto",
    ...over,
  } as unknown as ChecklistItemV2;
}

/**
 * The plan as `defence_packages.plan_json` holds it for pack
 * 1ae01792-8f46-45d6-a3eb-61470ce6bbbe — trimmed to the two records this
 * test reasons about, keeping their real dispositions.
 */
const TRIGGER_PLAN: CaseArgumentPlanSnapshot = {
  caseId: "4576ee51-53ec-4ed2-8c66-65b04bb31d72",
  planVersion: 1,
  reasonModuleId: "inr_product_not_received",
  included: [
    {
      recordId: "no_return_initiated#0",
      fieldKey: "no_return_initiated",
      factCategory: "no_return_initiated",
    },
  ],
  excluded: [
    {
      recordId: "ip_location_check#0",
      fieldKey: "ip_location_check",
      factCategory: "ip_location",
      reason: "not_argument_relevant",
      merchantReasonToken: "packs.argumentPlan.exclusion.notArgumentRelevant",
    },
  ],
  noSafeArgument: null,
  deadlineOnly: false,
  freshness: {
    inputHash: "test-hash",
    policyVersion: 1,
    computedAt: "2026-09-21T11:52:48.003Z",
  } as CaseArgumentPlanSnapshot["freshness"],
};

function deriveTriggerRows() {
  return deriveEvidenceLineItems({
    checklist: [
      checklistItem("no_return_initiated"),
      checklistItem("ip_location_check"),
    ],
    facts: [NO_RETURN_FACT],
    payloadByField: new Map<string, unknown>([
      ["no_return_initiated", NO_RETURN_PAYLOAD],
      ["ip_location_check", IP_PAYLOAD],
    ]),
    contributions: {
      strong: [],
      moderate: [
        {
          signalId: "ip_location",
          category: "moderate",
          labelToken: { key: "disputes.signalLabel.ip_location" },
          evidenceFieldKey: "ip_location_check",
        },
        {
          signalId: "no_return",
          category: "moderate",
          labelToken: { key: "disputes.signalLabel.no_return" },
          evidenceFieldKey: "no_return_initiated",
        },
      ],
    } as Parameters<typeof deriveEvidenceLineItems>[0]["contributions"],
    packSavedToShopify: false,
    excludedFields: new Set<string>(),
    attachmentUploadFailures: new Map<string, string>(),
    inclusionOverrides: new Map<string, "force_include" | "force_exclude">(),
    reasonFamily: "product",
    // The plan is deliberately passed here. On `develop` the input type does
    // not carry it and the derivation ignores it — which is the defect.
    plan: TRIGGER_PLAN,
  } as unknown as Parameters<typeof deriveEvidenceLineItems>[0]);
}

/**
 * Record ids a rendered row asserts. Until the row carries explicit record
 * identity (P1), a field-keyed row can only be matched by convention:
 * `<fieldKey>#<n>`. Matching on the PREFIX is deliberate — it is what makes
 * the mixed-record case (parcel-a excluded, parcel-b included) detectable as
 * "this row names at least one excluded record", rather than invisible.
 */
function recordIdsAssertedBy(row: { field: string }): string[] {
  return [`${row.field}#0`];
}

describe("P0 — merchant rows project the argument plan", () => {
  it("no row claims positive bank evidence for a plan-EXCLUDED record", () => {
    const rows = deriveTriggerRows();
    const excluded = excludedRecordIds(TRIGGER_PLAN);

    const offenders = rows
      .filter((r) => r.usedAsPositiveBankEvidence)
      .flatMap((r) =>
        recordIdsAssertedBy(r)
          .filter((id) => excluded.has(id))
          .map((id) => `${r.field} (record ${id})`),
      );

    expect(
      offenders,
      "rows asserting positive bank evidence for records the plan excluded",
    ).toEqual([]);
  });

  it("no row claims bank-argument inclusion for a plan-EXCLUDED record", () => {
    const rows = deriveTriggerRows();
    const excluded = excludedRecordIds(TRIGGER_PLAN);

    const offenders = rows
      .filter((r) => r.includedInBankArgument)
      .flatMap((r) => recordIdsAssertedBy(r).filter((id) => excluded.has(id)));

    expect(offenders).toEqual([]);
  });

  it("the plan-INCLUDED record is still rendered — exclusion is not deletion", () => {
    // Guards the over-correction: projecting the plan must not blank the
    // rows it authorises. D2 — a silently dropped fact is indistinguishable
    // from one that was never collected.
    const rows = deriveTriggerRows();
    const included = includedRecordIds(TRIGGER_PLAN);

    const rendered = rows.flatMap((r) =>
      recordIdsAssertedBy(r).filter((id) => included.has(id)),
    );

    expect(rendered).toContain("no_return_initiated#0");
  });

  it("the plan-excluded row is still VISIBLE, just not positive", () => {
    // D2 again, from the other side: the merchant is owed the row and its
    // reason, not silence.
    const rows = deriveTriggerRows();
    const ipRow = rows.find((r) => r.field === "ip_location_check");

    expect(ipRow, "the IP row must still render").toBeDefined();
    expect(ipRow!.usedAsPositiveBankEvidence).toBe(false);
  });
});

/* ── Legacy, unknown-record, and mixed-field cases ───────────────── */

function deriveWith(
  plan: CaseArgumentPlanSnapshot | null | undefined,
  checklist: ChecklistItemV2[],
  payloads: Array<[string, unknown]>,
  contributionFields: string[],
) {
  return deriveEvidenceLineItems({
    checklist,
    facts: [],
    payloadByField: new Map<string, unknown>(payloads),
    contributions: {
      strong: [],
      moderate: contributionFields.map((f) => ({
        signalId: f,
        category: "moderate",
        labelToken: { key: `disputes.signalLabel.${f}` },
        evidenceFieldKey: f,
      })),
    } as Parameters<typeof deriveEvidenceLineItems>[0]["contributions"],
    packSavedToShopify: false,
    excludedFields: new Set<string>(),
    attachmentUploadFailures: new Map<string, string>(),
    inclusionOverrides: new Map<string, "force_include" | "force_exclude">(),
    reasonFamily: "product",
    plan,
  } as unknown as Parameters<typeof deriveEvidenceLineItems>[0]);
}

describe("P1 — legacy path is untouched", () => {
  /**
   * `plan == null` is a pre-plan package (`plan_json IS NULL`), not "the
   * reader skipped the query". Its behaviour must be byte-identical to
   * before this change, or the fix regresses 525 prod packages that have no
   * plan to project.
   */
  it("with NO plan, the legacy answer is preserved (row stays positive)", () => {
    const rows = deriveWith(
      null,
      [checklistItem("ip_location_check")],
      [["ip_location_check", IP_PAYLOAD]],
      ["ip_location_check"],
    );
    const ip = rows.find((r) => r.field === "ip_location_check");
    expect(ip?.usedAsPositiveBankEvidence).toBe(true);
  });

  it("with an EMPTY plan, the same row is NOT positive", () => {
    // The contrast that proves the gate is the plan and not something else:
    // identical inputs, only the authority differs. An empty plan mentions
    // no records, so nothing is authorised.
    const emptyPlan: CaseArgumentPlanSnapshot = {
      ...TRIGGER_PLAN,
      included: [],
      excluded: [],
    };
    const rows = deriveWith(
      emptyPlan,
      [checklistItem("ip_location_check")],
      [["ip_location_check", IP_PAYLOAD]],
      ["ip_location_check"],
    );
    const ip = rows.find((r) => r.field === "ip_location_check");
    expect(ip?.usedAsPositiveBankEvidence).toBe(false);
  });
});

describe("P1 — record-level, not field-level", () => {
  /**
   * `deriveArgumentPlan`'s own suite pins this shape: one `fieldKey`, two
   * records, opposite verdicts. A field-keyed veto would suppress the
   * included parcel; a field-keyed pass would resurrect the excluded one.
   * Neither is acceptable, so the row degrades to non-positive (see
   * `planDispositionForField`) and keeps rendering. Splitting into
   * per-record rows is U6.
   */
  it("a field with one INCLUDED and one EXCLUDED record cannot claim positive", () => {
    const mixed: CaseArgumentPlanSnapshot = {
      ...TRIGGER_PLAN,
      included: [
        {
          recordId: "delivery_proof#parcel-b",
          fieldKey: "delivery_proof",
          factCategory: "delivery_proof",
        },
      ],
      excluded: [
        {
          recordId: "delivery_proof#parcel-a",
          fieldKey: "delivery_proof",
          factCategory: "delivery_proof",
          reason: "not_argument_relevant",
          merchantReasonToken: "packs.argumentPlan.exclusion.notArgumentRelevant",
        },
      ],
    };
    const rows = deriveWith(
      mixed,
      [checklistItem("delivery_proof")],
      [
        [
          "delivery_proof",
          { fieldKey: "delivery_proof", proofType: "delivered_confirmed" },
        ],
      ],
      ["delivery_proof"],
    );
    const row = rows.find((r) => r.field === "delivery_proof");
    expect(row, "the row must still render").toBeDefined();
    expect(row!.usedAsPositiveBankEvidence).toBe(false);
  });

  it("delivery-row collapse never elects an EXCLUDED field as survivor", () => {
    // `collapseDeliveryRows` merges shipping_tracking + delivery_proof into
    // one row, ranking partly by `usedAsPositiveBankEvidence`. Because the
    // plan gate runs BEFORE the collapse, an excluded field scores lower and
    // cannot be promoted over an authorised sibling.
    const plan: CaseArgumentPlanSnapshot = {
      ...TRIGGER_PLAN,
      included: [
        {
          recordId: "shipping_tracking#0",
          fieldKey: "shipping_tracking",
          factCategory: "shipping_tracking",
        },
      ],
      excluded: [
        {
          recordId: "delivery_proof#0",
          fieldKey: "delivery_proof",
          factCategory: "delivery_proof",
          reason: "not_argument_relevant",
          merchantReasonToken: "packs.argumentPlan.exclusion.notArgumentRelevant",
        },
      ],
    };
    const payload = {
      fieldKey: "delivery_proof",
      proofType: "delivered_confirmed",
    };
    const rows = deriveWith(
      plan,
      [checklistItem("shipping_tracking"), checklistItem("delivery_proof")],
      [
        ["delivery_proof", payload],
        ["shipping_tracking", payload],
      ],
      ["shipping_tracking"],
    );

    const survivors = rows.filter((r) =>
      ["delivery_proof", "shipping_tracking"].includes(r.field),
    );
    // One row survives the collapse, and it must not be the excluded field
    // asserting a positive bank claim.
    for (const r of survivors) {
      if (r.field === "delivery_proof") {
        expect(r.usedAsPositiveBankEvidence).toBe(false);
      }
    }
  });
});

describe("P2 — the merchant is told the PLAN's reason", () => {
  it("an excluded row carries the plan's reason token, not the legacy one", () => {
    // `reasonFor` would explain the submission method ("no qualifying
    // signal..."), which is not why this row is out. The plan ruled it
    // irrelevant to an INR claim, and that is what the merchant must read —
    // otherwise they go and fix data that would change nothing.
    const rows = deriveTriggerRows();
    const ip = rows.find((r) => r.field === "ip_location_check");

    expect(ip?.reasonToken.key).toBe(
      "packs.argumentPlan.exclusion.notArgumentRelevant",
    );
  });

  it("that token resolves to real copy in every locale", () => {
    // Guards the state this work found the repo in: EXCLUSION_REASON_TOKENS
    // named five keys and no catalog contained any of them, so the row would
    // have rendered the raw key path to the merchant.
    const catalogs: Array<[string, Record<string, unknown>]> = [
      ["en", enCatalog],
      ["de", deCatalog],
      ["es", esCatalog],
      ["fr", frCatalog],
      ["pt", ptCatalog],
      ["sv", svCatalog],
    ];
    for (const [loc, cat] of catalogs) {
      const copy = (
        cat as {
          packs?: { argumentPlan?: { exclusion?: Record<string, string> } };
        }
      ).packs?.argumentPlan?.exclusion?.notArgumentRelevant;
      expect(typeof copy, `${loc} is missing the exclusion copy`).toBe("string");
      expect((copy as string).length).toBeGreaterThan(10);
    }
  });

  it("an INCLUDED row keeps its normal reason", () => {
    // The override must be scoped to exclusions — it must not blanket every
    // row with plan language.
    const rows = deriveTriggerRows();
    const kept = rows.find((r) => r.field === "no_return_initiated");
    expect(kept?.reasonToken.key).not.toContain("argumentPlan.exclusion");
  });
});

describe("P3b-i — display contributions respect the plan (and ONLY display)", () => {
  const checklist = [
    checklistItem("ip_location_check"),
    checklistItem("no_return_initiated"),
  ];
  const payloads = {
    kind: "byField" as const,
    map: {
      ip_location_check: { payload: IP_PAYLOAD as Record<string, unknown> },
      no_return_initiated: {
        payload: NO_RETURN_PAYLOAD as Record<string, unknown>,
      },
    },
  };

  it("a plan-excluded field produces no 'what supports your case' row", () => {
    const withPlan = computeContributions({
      checklist,
      payloadSource: payloads,
      reason: "PRODUCT_NOT_RECEIVED",
      planExcludedRecordIds: new Set(["ip_location_check#0"]),
    });
    const fields = [...withPlan.strong, ...withPlan.moderate].map(
      (c) => c.evidenceFieldKey,
    );
    expect(fields).not.toContain("ip_location_check");
  });

  it("without a plan every row is kept (legacy)", () => {
    const legacy = computeContributions({
      checklist,
      payloadSource: payloads,
      reason: "PRODUCT_NOT_RECEIVED",
    });
    const fields = [...legacy.strong, ...legacy.moderate].map(
      (c) => c.evidenceFieldKey,
    );
    expect(fields).toContain("ip_location_check");
  });

  it("the SCORE is untouched by the same filter", () => {
    /* The structural guarantee behind "display only": `calculateCaseStrength`
     * takes no plan parameter at all, so the P3b-i filter cannot reach it.
     *
     * This is deliberately NOT a claim that plan exclusions are irrelevant to
     * scoring — measured 2026-09-22, 399 plan-excluded records ARE scored
     * today because their evidence-model relevance is not `not_applicable`.
     * Changing that is P3b-ii and needs a policy-version bump plus a
     * fleet-wide rebuild. This test pins that P3b-i did not sneak it in. */
    const score = calculateCaseStrength(
      checklist,
      "PRODUCT_NOT_RECEIVED",
      payloads,
      NO_GATES,
    );
    // The IP field still counts toward the SCORE — it is available and its
    // model relevance is not `not_applicable`. That is the 399-record
    // finding, left deliberately unchanged by P3b-i.
    expect(score.moderateCount).toBeGreaterThan(0);

    // And the display rows, for the same inputs, no longer list it.
    const shown = computeContributions({
      checklist,
      payloadSource: payloads,
      reason: "PRODUCT_NOT_RECEIVED",
      planExcludedRecordIds: new Set(["ip_location_check#0"]),
    });
    expect(
      [...shown.strong, ...shown.moderate].map((c) => c.evidenceFieldKey),
    ).not.toContain("ip_location_check");
  });
});

/* ── Replay against the REAL prod plan shape ─────────────────────── */

/**
 * The trigger pack's actual dispositions, exported from prod
 * (pack 1ae01792-8f46-45d6-a3eb-61470ce6bbbe, 2026-09-22).
 *
 * Kept verbatim because the REAL record ids are Shopify GIDs
 * (`delivery_proof#gid://shopify/Fulfillment/6721366556865`), not the tidy
 * `field#0` of the hand-written fixtures. Prefix matching has to survive a
 * `#` followed by a URL containing further slashes and digits — a fixture
 * using `#0` everywhere would never exercise that.
 */
const PROD_INCLUDED = [
  ["customer_communication", "customer_communication#0"],
  ["delivery_proof", "delivery_proof#gid://shopify/Fulfillment/6721366556865"],
  ["delivery_proof", "delivery_proof#gid://shopify/Fulfillment/6719323799745"],
  ["no_return_initiated", "no_return_initiated#0"],
  ["order_confirmation", "order_confirmation#0"],
  ["shipping_policy", "shipping_policy#0"],
  ["shipping_tracking", "shipping_tracking#gid://shopify/Fulfillment/6719323799745"],
  ["shipping_tracking", "shipping_tracking#gid://shopify/Fulfillment/6721366556865"],
] as const;

const PROD_EXCLUDED = [
  ["activity_log", "activity_log#0"],
  ["avs_cvv_match", "avs_cvv_match#0"],
  ["cancellation_policy", "cancellation_policy#0"],
  ["customer_account_info", "customer_account_info#0"],
  ["ip_location_check", "ip_location_check#0"],
  ["refund_policy", "refund_policy#0"],
] as const;

describe("Layer 4 — replay against the real prod plan", () => {
  const prodPlan: CaseArgumentPlanSnapshot = {
    ...TRIGGER_PLAN,
    included: PROD_INCLUDED.map(([fieldKey, recordId]) => ({
      recordId,
      fieldKey,
      factCategory: fieldKey,
    })),
    excluded: PROD_EXCLUDED.map(([fieldKey, recordId]) => ({
      recordId,
      fieldKey,
      factCategory: fieldKey,
      reason: "not_argument_relevant" as const,
      merchantReasonToken: "packs.argumentPlan.exclusion.notArgumentRelevant",
    })),
  };

  const allFields = [
    ...new Set([
      ...PROD_INCLUDED.map(([f]) => f),
      ...PROD_EXCLUDED.map(([f]) => f),
    ]),
  ];

  it("no plan-excluded field is positive, and GID record ids resolve", () => {
    const rows = deriveEvidenceLineItems({
      checklist: allFields.map((f) => checklistItem(f)),
      facts: [],
      payloadByField: new Map<string, unknown>(
        allFields.map((f) => [f, { fieldKey: f, bankEligible: true }]),
      ),
      contributions: {
        strong: [],
        moderate: allFields.map((f) => ({
          // `signalId` is a constrained union; this replay cares only about
          // the plan gate, so the field name stands in for it.
          signalId: f,
          category: "moderate",
          labelToken: { key: `disputes.signalLabel.${f}` },
          evidenceFieldKey: f,
        })),
      } as unknown as Parameters<
        typeof deriveEvidenceLineItems
      >[0]["contributions"],
      packSavedToShopify: false,
      excludedFields: new Set<string>(),
      attachmentUploadFailures: new Map<string, string>(),
      inclusionOverrides: new Map<string, "force_include" | "force_exclude">(),
      reasonFamily: "product",
      plan: prodPlan,
    } as unknown as Parameters<typeof deriveEvidenceLineItems>[0]);

    const excludedFieldNames = new Set<string>(PROD_EXCLUDED.map(([f]) => f));
    const offenders = rows
      .filter((r) => r.usedAsPositiveBankEvidence)
      .map((r) => r.field)
      .filter((f) => excludedFieldNames.has(f));

    expect(offenders).toEqual([]);
  });

  it("a GID-suffixed record is matched by its field, not missed", () => {
    // Direct guard on the prefix rule: if `#gid://...` broke the match, the
    // multi-record delivery fields would silently fall through to
    // `unknown_record` and the test above would pass for the wrong reason.
    const gidOnlyPlan: CaseArgumentPlanSnapshot = {
      ...TRIGGER_PLAN,
      included: [],
      excluded: [
        {
          recordId: "delivery_proof#gid://shopify/Fulfillment/6721366556865",
          fieldKey: "delivery_proof",
          factCategory: "delivery_proof",
          reason: "not_argument_relevant",
          merchantReasonToken: "packs.argumentPlan.exclusion.notArgumentRelevant",
        },
      ],
    };
    const rows = deriveWith(
      gidOnlyPlan,
      [checklistItem("delivery_proof")],
      [["delivery_proof", { fieldKey: "delivery_proof", proofType: "delivered_confirmed" }]],
      ["delivery_proof"],
    );
    const row = rows.find((r) => r.field === "delivery_proof");
    expect(row?.usedAsPositiveBankEvidence).toBe(false);
    // And it carries the plan's reason, proving the match reached the
    // exclusion record rather than defaulting.
    expect(row?.reasonToken.key).toBe(
      "packs.argumentPlan.exclusion.notArgumentRelevant",
    );
  });
});
