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
import { excludedRecordIds, includedRecordIds } from "@/lib/argument/plan/deriveArgumentPlan";
import type { CaseArgumentPlanSnapshot } from "@/lib/pipeline/contracts";
import type { ChecklistItemV2 } from "@/lib/automation/completeness";
import type { EvidenceFact } from "@/lib/defence/types";

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
