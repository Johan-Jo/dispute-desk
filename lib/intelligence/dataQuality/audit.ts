/**
 * Data-quality assessment (design §2, §8). Consumes the deterministic SQL
 * facts (intel_data_quality_audit) and assigns each input area a reliability
 * status + the risk-leakage verdict + global limitations. Measurement stays in
 * SQL; only labelling happens here, against config thresholds.
 */

import type {
  DataQualityFacts, DataQualityReport, DataAreaAssessment, DataAreaStatus,
} from "../types";
import { DATA_QUALITY_THRESHOLDS as T } from "../config";
import { runDataQualityAudit } from "../db/tenantScope";

function statusFromMissing(pct: number | null, rows: number): DataAreaStatus {
  if (pct === null) return "unknown";
  if (rows < T.minRowsUsable) return "insufficient";
  if (pct <= T.reliableMaxMissingPct && rows >= T.minRowsReliable) return "reliable";
  if (pct <= T.usableMaxMissingPct) return "usable_with_limitations";
  return "insufficient";
}

export async function assessDataQuality(shopId: string): Promise<DataQualityReport> {
  const facts = await runDataQualityAudit(shopId);
  return buildReport(facts);
}

/** Pure — separated for unit testing against fixed facts. */
export function buildReport(facts: DataQualityFacts): DataQualityReport {
  const orders = facts.orders;
  const disputes = facts.disputes;
  const areas: DataAreaAssessment[] = [];

  // Orders volume / span.
  areas.push({
    area: "orders",
    status: orders.count >= T.minRowsReliable ? "reliable" : orders.count >= T.minRowsUsable ? "usable_with_limitations" : "insufficient",
    reason: `${orders.count} orders, ${orders.distinct_currencies} currency(ies), coverage from ${orders.coverage_start ?? "?"}`,
    notes: ["Import completion confirms the requested import only — earlier history not proven absent."],
  });

  // Dispute outcomes (the analysis backbone).
  areas.push({
    area: "dispute_outcomes",
    status: statusFromMissing(disputes.pct_null_final_outcome, disputes.count),
    reason: `${disputes.count} disputes, ${disputes.count_adjudicated} adjudicated, ${disputes.count_with_outcome_amount} with amounts`,
    notes: [`${disputes.pct_null_final_outcome ?? "?"}% null final_outcome`],
  });

  // Response availability.
  areas.push({
    area: "response_analysis",
    status: disputes.count_submitted >= T.minRowsUsable ? "usable_with_limitations" : "insufficient",
    reason: `${disputes.count_submitted} submitted; ${disputes.count_with_response_opportunity} with an establishable response opportunity`,
    notes: ["Responded-vs-unanswered comparisons are selection-biased, non-causal."],
  });

  // Order↔dispute linkage.
  areas.push({
    area: "order_dispute_linkage",
    status: (disputes.pct_orphan_no_order ?? 100) <= 1 ? "reliable" : "usable_with_limitations",
    reason: `${disputes.pct_orphan_no_order ?? "?"}% disputes without an order_gid; has_chargeback flag unused (join via order_gid)`,
  });

  // Delivery signal.
  areas.push({
    area: "delivery_signal",
    status: statusFromMissing(orders.pct_null_delivery_status, orders.count),
    reason: `${orders.pct_null_delivery_status ?? "?"}% null delivery_status`,
    notes: ["Missing ≠ not delivered. Underlying-event time unverified (§14.11)."],
  });

  // Network reason codes.
  areas.push({
    area: "network_reason_codes",
    status: (disputes.pct_network_code_direct_or_derived ?? 0) >= 50 ? "usable_with_limitations" : "insufficient",
    reason: `${disputes.pct_network_code_direct_or_derived ?? "?"}% direct/derived (rest inferred)`,
    notes: ["Use coarse disputes.reason; avoid reason-code-level segmentation when mostly inferred."],
  });

  // Risk leakage verdict.
  const lag = facts.leakage.median_ingest_lag_hours;
  const riskPreventionSupported =
    lag !== null && lag <= T.riskLeakageMaxLagHours;
  areas.push({
    area: "risk_features",
    status: riskPreventionSupported ? "usable_with_limitations" : "insufficient",
    reason: `median ingest lag ${lag ?? "?"}h; ${facts.leakage.pct_ingested_within_48h ?? "?"}% within 48h`,
    notes: [
      riskPreventionSupported
        ? "Ingest is near order time; provenance still requires §14.1 confirmation."
        : "Ingest lag indicates risk_level_initial is retrospective — risk-based prevention SUPPRESSED (leakage). Provenance: §14.1.",
    ],
  });

  const globalLimitations: string[] = [
    "Descriptive terms (resolved/win/recovery) follow the §7.1 terminal-set definitions.",
    "Absent per-order AVS/CVV/3DS/margin and refund/return chronology → dependent analyses suppressed.",
  ];
  if (!riskPreventionSupported) {
    globalLimitations.push("Risk-based prevention is retrospective-only and suppressed for backfilled orders.");
  }
  if ((disputes.pct_network_code_direct_or_derived ?? 0) < 50) {
    globalLimitations.push("Network reason codes are mostly inferred → no reason-code-level segmentation.");
  }
  if (disputes.count < 500) {
    globalLimitations.push(`Small dispute N (${disputes.count}) → most fine segments fall below sample gates and are suppressed.`);
  }

  return { facts, areas, riskPreventionSupported, globalLimitations };
}
