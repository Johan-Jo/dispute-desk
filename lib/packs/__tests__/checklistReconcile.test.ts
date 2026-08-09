import { describe, expect, it } from "vitest";
import {
  collectedFieldsFromPack,
  normalizeChecklistV2Shape,
  reconcileChecklistWithCollectedFields,
} from "../checklistReconcile";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

const item = (
  field: string,
  status: ChecklistItemV2["status"],
): ChecklistItemV2 =>
  ({
    field,
    label: field,
    status,
    priority: "recommended",
    blocking: false,
    source: "auto_shopify",
  }) as ChecklistItemV2;

describe("collectedFieldsFromPack", () => {
  it("unions fieldsProvided across sections and evidence_items", () => {
    const set = collectedFieldsFromPack({
      sections: [
        { fieldsProvided: ["order_confirmation", "activity_log"] },
        { fieldsProvided: ["refund_policy"] },
        { fieldsProvided: null },
      ],
      evidenceItems: [
        { payload: { fieldsProvided: ["avs_cvv_match"] } },
        { payload: null },
      ],
    });
    expect([...set].sort()).toEqual([
      "activity_log",
      "avs_cvv_match",
      "order_confirmation",
      "refund_policy",
    ]);
  });

  it("returns an empty set when nothing is provided", () => {
    expect(collectedFieldsFromPack({}).size).toBe(0);
  });

  it("treats payload.checklistField on manual_upload as a collected field (regression: missing-row stays hidden after upload)", () => {
    // POST /api/packs/:id/upload now mirrors `checklistField` into
    // `fieldsProvided`, but legacy rows persisted only `checklistField`.
    // Both shapes must surface the field as collected so the Evidence
    // Used in Defense section flips the row from missing → available.
    const set = collectedFieldsFromPack({
      sections: [],
      evidenceItems: [
        // legacy shape (no fieldsProvided)
        {
          source: "manual_upload",
          payload: { checklistField: "customer_communication" },
        },
        // new shape (mirrored)
        {
          source: "manual_upload",
          payload: {
            fieldsProvided: ["delivery_proof"],
            checklistField: "delivery_proof",
          },
        },
        // non-manual rows are unaffected (no checklistField fallback)
        {
          source: "auto_shopify",
          payload: { checklistField: "order_confirmation" },
        },
      ],
    });
    expect([...set].sort()).toEqual(["customer_communication", "delivery_proof"]);
  });
});

describe("reconcileChecklistWithCollectedFields", () => {
  it("flips missing → available when the field is in collectedFields", () => {
    const out = reconcileChecklistWithCollectedFields(
      [
        item("refund_policy", "missing"),
        item("shipping_policy", "missing"),
      ],
      new Set(["refund_policy", "shipping_policy"]),
    );
    expect(out.map((c) => c.status)).toEqual(["available", "available"]);
  });

  it("preserves unavailable, waived, and already-available statuses", () => {
    const out = reconcileChecklistWithCollectedFields(
      [
        item("delivery_proof", "unavailable"),
        item("supporting_documents", "waived"),
        item("avs_cvv_match", "available"),
      ],
      new Set(["delivery_proof", "supporting_documents", "avs_cvv_match"]),
    );
    expect(out.map((c) => c.status)).toEqual([
      "unavailable",
      "waived",
      "available",
    ]);
  });

  it("leaves missing rows alone when the field is NOT in collectedFields", () => {
    const out = reconcileChecklistWithCollectedFields(
      [item("shipping_policy", "missing")],
      new Set(["refund_policy"]),
    );
    expect(out[0]!.status).toBe("missing");
  });

  it("DROPS a retired field's row whatever status it was persisted with", () => {
    // PR-C4 / C-14. 112 prod packs still carry a `billing_address_match` row
    // (97 `available`, 15 `missing`). A template edit cannot reach them; this
    // function can, and it is the one both pipelines pass through.
    for (const status of ["available", "missing", "unavailable", "waived"] as const) {
      const out = reconcileChecklistWithCollectedFields(
        [item("billing_address_match", status), item("order_confirmation", "available")],
        new Set(["billing_address_match", "order_confirmation"]),
      );
      expect(out.map((c) => c.field), status).toEqual(["order_confirmation"]);
    }
  });

  it("reproduces the dispute aee832ad scenario", () => {
    // Pack 424bedfd snapshot: 4 stale-missing rows that the collectors
    // actually produced. Reconciliation must flip exactly these.
    const checklist: ChecklistItemV2[] = [
      item("order_confirmation", "available"),
      item("avs_cvv_match", "available"),
      item("activity_log", "available"),
      item("ip_location_check", "missing"), // collected — flips
      item("shipping_tracking", "available"),
      item("delivery_proof", "unavailable"), // preserved
      item("customer_communication", "available"),
      item("refund_policy", "missing"), // collected — flips
      item("shipping_policy", "missing"), // collected — flips
      item("cancellation_policy", "missing"), // collected — flips
      item("supporting_documents", "available"),
    ];
    const collected = new Set([
      "order_confirmation",
      "activity_log",
      "customer_account_info",
      "cancellation_policy",
      "refund_policy",
      "shipping_policy",
      "avs_cvv_match",
      "ip_location_check",
    ]);
    const out = reconcileChecklistWithCollectedFields(checklist, collected);
    const status = (f: string) => out.find((c) => c.field === f)?.status;

    expect(status("ip_location_check")).toBe("available");
    expect(status("refund_policy")).toBe("available");
    expect(status("shipping_policy")).toBe("available");
    expect(status("cancellation_policy")).toBe("available");
    expect(status("billing_address_match")).toBeUndefined(); // retired (PR-C4)
    expect(status("delivery_proof")).toBe("unavailable");
  });
});

describe("normalizeChecklistV2Shape — defensive read-side unwrap", () => {
  // Regression: seed packs persisted `checklist_v2` as the legacy v1
  // wrapper shape `{ items: [...] }`. The route used to cast as
  // `ChecklistItemV2[]` and crash with `TypeError: a.map is not a
  // function`. This normalizer accepts either shape.
  const sample = [item("order_confirmation", "missing")];

  it("passes a flat array through unchanged", () => {
    expect(normalizeChecklistV2Shape(sample)).toBe(sample);
  });

  it("unwraps the legacy { items: [...] } wrapper", () => {
    expect(normalizeChecklistV2Shape({ items: sample })).toEqual(sample);
  });

  it("returns null for nullish or unrecognized shapes", () => {
    expect(normalizeChecklistV2Shape(null)).toBeNull();
    expect(normalizeChecklistV2Shape(undefined)).toBeNull();
    expect(normalizeChecklistV2Shape({})).toBeNull();
    expect(normalizeChecklistV2Shape("string")).toBeNull();
    expect(normalizeChecklistV2Shape({ items: "not-array" })).toBeNull();
  });

  it("reconcile accepts the wrapper shape without crashing", () => {
    expect(() =>
      reconcileChecklistWithCollectedFields(
        { items: sample } as unknown as ChecklistItemV2[],
        new Set(),
      ),
    ).not.toThrow();
  });
});

/**
 * The append rule (2026-08-04). Reconcile could previously only FLIP an
 * existing row, so a collected field with no template row was invisible on
 * every merchant surface and skipped by the scorer — while `factClassifier`
 * read `pack_json.sections` directly and cited it to the issuer. That is
 * blume-box #352552's 3-D Secure liability shift.
 */
describe("appends collected fields the template never gave a row", () => {
  it("adds a row for a collected canonical field that is absent", () => {
    const out = reconcileChecklistWithCollectedFields(
      [
        {
          field: "order_confirmation",
          label: "Order Confirmation",
          status: "available",
          priority: "critical",
          blocking: false,
          source: "auto_shopify",
        },
      ],
      new Set(["order_confirmation", "tds_authentication"]),
    );
    const tds = out.find((c) => c.field === "tds_authentication");
    expect(tds, "3-D Secure was collected but got no checklist row").toBeTruthy();
    expect(tds!.status).toBe("available");
    // The reason template did not ask for it, so it must not outweigh a field
    // it did — `optional` is weight 0.1 in deriveCompletenessMetrics.
    expect(tds!.priority).toBe("optional");
    expect(tds!.blocking).toBe(false);
    // English label intentionally empty: lib/** may not emit English, and
    // every render site resolves from CANONICAL_EVIDENCE[field].labelKey.
    expect(tds!.label).toBe("");
  });

  it("does not append a field that was not collected", () => {
    const out = reconcileChecklistWithCollectedFields([], new Set([]));
    expect(out).toEqual([]);
  });

  it("ignores unregistered field keys instead of rendering them", () => {
    const out = reconcileChecklistWithCollectedFields(
      [],
      new Set(["not_a_real_field", "shopify_protect_coverage"]),
    );
    // shopify_protect_coverage is domain `coverage`, not evidence — it is a
    // gate, and must never appear as a merchant evidence row.
    expect(out).toEqual([]);
  });

  it("renders a pack whose checklist is NULL but whose sections collected evidence", () => {
    // surasvenne #SEED-1001 on dev: pack `ready`, 5 collected sections,
    // checklist_v2 NULL — the dispute page rendered completely empty while
    // every one of those fields was citable to the issuer. The early
    // `return []` on an unparseable checklist caused it.
    const out = reconcileChecklistWithCollectedFields(
      null,
      new Set(["order_confirmation", "avs_cvv_match", "delivery_proof"]),
    );
    expect(out.map((c) => c.field).sort()).toEqual([
      "avs_cvv_match",
      "delivery_proof",
      "order_confirmation",
    ]);
    expect(out.every((c) => c.status === "available")).toBe(true);
  });
});
