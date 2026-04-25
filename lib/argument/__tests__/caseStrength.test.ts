/**
 * Case strength engine — count-based formula tests.
 * Plan v3 §P2.9 #1–#13.
 *
 * Covers:
 *   #1  2 strong → Strong
 *   #2  1 strong + 1 moderate → Moderate
 *   #3  1 strong + 0 moderate → Weak
 *   #4  0 strong + N supporting → Weak (any N)
 *   #5  Canonical-once dedup via shared signalId
 *   #6  delivery_proof signature_confirmed → strong path
 *   #7  delivery_proof delivered_confirmed → moderate path
 *   #8  delivery_proof label_created → not counted
 *   #9  customer_communication always supporting, never strong
 *   #10 ip_location_check positive → moderate; VPN → supporting
 *   #11 Same signalId via multiple keys → counted once
 *   #13 Supporting exclusion under any input
 */

import { describe, expect, it } from "vitest";
import { calculateCaseStrength } from "../caseStrength";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { ArgumentMap } from "../types";

function item(field: string, status: ChecklistItemV2["status"] = "available"): ChecklistItemV2 {
  return {
    field,
    label: field,
    priority: "critical",
    status,
    blocking: false,
    collectionType: "manual",
  } as ChecklistItemV2;
}

function emptyArgMap(reason = "FRAUDULENT"): ArgumentMap {
  return {
    issuerClaim: { text: "", reasonCode: reason },
    counterclaims: [],
    overallStrength: "insufficient",
  };
}

function payloadFor(map: Record<string, Record<string, unknown> | null>) {
  return {
    kind: "byField" as const,
    map: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v ? { payload: v } : null])),
  };
}

describe("calculateCaseStrength — count-based formula (plan §P2.9)", () => {
  it("#1 — two strong items → Strong", () => {
    const checklist = [item("avs_cvv_match"), item("billing_address_match")];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
      billing_address_match: { match: true },
    }));
    expect(result.strongCount).toBe(2);
    expect(result.overall).toBe("strong");
  });

  it("#2 — 1 strong + 1 moderate → Moderate", () => {
    const checklist = [item("avs_cvv_match"), item("ip_location_check")];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
      ip_location_check: { bankEligible: true, locationMatch: "match", ipinfo: { privacy: { vpn: false } } },
    }));
    expect(result.strongCount).toBe(1);
    expect(result.moderateCount).toBe(1);
    expect(result.overall).toBe("moderate");
  });

  it("#3 — 1 strong, 0 moderate → Weak", () => {
    const checklist = [item("avs_cvv_match")];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
    }));
    expect(result.strongCount).toBe(1);
    expect(result.moderateCount).toBe(0);
    expect(result.overall).toBe("weak");
  });

  it("#4 — 0 strong + many supporting → Weak (P2.1.1 enforcement)", () => {
    const checklist = [
      item("customer_communication"),
      item("customer_account_info"),
      item("activity_log"),
      item("order_confirmation"),
      item("refund_policy"),
      item("shipping_policy"),
    ];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      customer_communication: { messages: 50 },
      customer_account_info: { totalOrders: 100 },
      activity_log: { events: 100 },
      order_confirmation: { orderName: "#1234" },
      refund_policy: { url: "..." },
      shipping_policy: { url: "..." },
    }));
    expect(result.strongCount).toBe(0);
    expect(result.moderateCount).toBe(0);
    expect(result.supportingCount).toBeGreaterThan(0);
    expect(result.overall).toBe("weak");
  });

  it("#13 — supporting exclusion under any input volume (1, 5, 50)", () => {
    for (const n of [1, 5, 50]) {
      const checklist: ChecklistItemV2[] = [];
      for (let i = 0; i < n; i++) {
        // Cycle through supporting fields. They all map to the
        // canonical "supporting" tier.
        const fields = ["customer_communication", "customer_account_info", "activity_log", "order_confirmation"];
        checklist.push(item(fields[i % fields.length]));
      }
      const payload: Record<string, Record<string, unknown>> = {};
      for (const field of new Set(checklist.map((c) => c.field))) {
        payload[field] = { x: 1 };
      }
      const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor(payload));
      expect(result.strongCount, `n=${n}`).toBe(0);
      expect(result.moderateCount, `n=${n}`).toBe(0);
      expect(result.overall, `n=${n}`).toBe("weak");
    }
  });

  it("#11 — duplicate signal via multiple keys → counted once", () => {
    // delivery_proof + shipping_tracking both share signalId "delivery"
    // and both have proofType "signature_confirmed" → category "strong".
    // The scorer must count this as ONE strong contribution, not two.
    const checklist = [item("delivery_proof"), item("shipping_tracking")];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "PRODUCT_NOT_RECEIVED", payloadFor({
      delivery_proof: { proofType: "signature_confirmed" },
      shipping_tracking: { proofType: "signature_confirmed" },
    }));
    expect(result.strongCount).toBe(1);
    expect(result.overall).toBe("weak"); // Only 1 strong, no moderate → weak
  });

  it("#11b — same signalId, two evidence_items, mixed categories → highest wins", () => {
    // delivery_proof signature_confirmed (strong) + shipping_tracking
    // delivered_unverified (supporting) → signal "delivery" gets strong.
    const checklist = [item("delivery_proof"), item("shipping_tracking"), item("avs_cvv_match")];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      delivery_proof: { proofType: "signature_confirmed" },
      shipping_tracking: { proofType: "delivered_unverified" },
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
    }));
    expect(result.strongCount).toBe(2); // delivery + payment_auth
    expect(result.overall).toBe("strong");
  });

  it("#6 — delivery_proof signature_confirmed → strong", () => {
    const checklist = [item("delivery_proof"), item("avs_cvv_match")];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      delivery_proof: { proofType: "signature_confirmed" },
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
    }));
    expect(result.strongCount).toBe(2);
    expect(result.overall).toBe("strong");
  });

  it("#7 — delivery_proof delivered_confirmed → moderate path", () => {
    const checklist = [item("delivery_proof"), item("avs_cvv_match")];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      delivery_proof: { proofType: "delivered_confirmed" },
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
    }));
    expect(result.strongCount).toBe(1); // avs_cvv only
    expect(result.moderateCount).toBe(1); // delivery
    expect(result.overall).toBe("moderate");
  });

  it("#8 — delivery_proof label_created → not counted", () => {
    const checklist = [item("delivery_proof"), item("avs_cvv_match")];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      delivery_proof: { proofType: "label_created" },
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
    }));
    expect(result.strongCount).toBe(1);
    expect(result.moderateCount).toBe(0);
    expect(result.overall).toBe("weak");
  });

  it("#9 — customer_communication never elevates, even with extreme volume", () => {
    const checklist = [
      item("customer_communication"),
      item("avs_cvv_match"),
      item("billing_address_match"),
    ];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      customer_communication: { messages: 9999 },
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
      billing_address_match: { match: true },
    }));
    // Strong is 2 (avs + billing); communication is supporting.
    expect(result.strongCount).toBe(2);
    expect(result.supportingCount).toBeGreaterThanOrEqual(1);
    expect(result.overall).toBe("strong");
  });

  it("#10 — ip_location_check positive → moderate; VPN → supporting", () => {
    const checklist = [item("ip_location_check"), item("avs_cvv_match")];

    const positive = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      ip_location_check: { bankEligible: true, locationMatch: "match", ipinfo: { privacy: { vpn: false } } },
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
    }));
    expect(positive.strongCount).toBe(1);
    expect(positive.moderateCount).toBe(1);
    expect(positive.overall).toBe("moderate");

    const vpn = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      ip_location_check: { bankEligible: true, locationMatch: "match", ipinfo: { privacy: { vpn: true } } },
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
    }));
    expect(vpn.strongCount).toBe(1);
    expect(vpn.moderateCount).toBe(0);
    expect(vpn.overall).toBe("weak");
  });

  it("missing items don't count toward strong/moderate", () => {
    const checklist = [
      item("avs_cvv_match", "missing"),
      item("billing_address_match", "missing"),
    ];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({}));
    expect(result.strongCount).toBe(0);
    expect(result.moderateCount).toBe(0);
    expect(result.overall).toBe("weak");
  });

  it("score = strongCount * 3 + moderateCount * 2 (P2.1 weights)", () => {
    const checklist = [item("avs_cvv_match"), item("ip_location_check")];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
      ip_location_check: { bankEligible: true, locationMatch: "match", ipinfo: { privacy: { vpn: false } } },
    }));
    expect(result.score).toBe(1 * 3 + 1 * 2);
  });

  it("coveragePercent reflects presentItems / registeredItems (legacy back-compat)", () => {
    const checklist = [
      item("avs_cvv_match", "available"),
      item("billing_address_match", "missing"),
    ];
    const result = calculateCaseStrength(emptyArgMap(), checklist, "FRAUDULENT", payloadFor({
      avs_cvv_match: { avsResultCode: "Y", cvvResultCode: "M" },
    }));
    expect(result.coveragePercent).toBe(50);
  });
});
