import { describe, expect, it } from "vitest";
import {
  collectedFieldsFromPack,
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
      [item("billing_address_match", "missing")],
      new Set(["refund_policy"]),
    );
    expect(out[0]!.status).toBe("missing");
  });

  it("reproduces the dispute aee832ad scenario", () => {
    // Pack 424bedfd snapshot: 4 stale-missing rows that the collectors
    // actually produced. Reconciliation must flip exactly these.
    const checklist: ChecklistItemV2[] = [
      item("order_confirmation", "available"),
      item("billing_address_match", "missing"), // not collected — stays missing
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
    expect(status("billing_address_match")).toBe("missing");
    expect(status("delivery_proof")).toBe("unavailable");
  });
});
