/**
 * Loads the raw rows `assembleSnapshot` needs. No rules live here — this file
 * only fetches, so that every classification decision stays unit-testable
 * without a database.
 *
 * Sources, and why these and not the ones the plan originally named:
 *
 *   defence_packages     the evidence inventory (`facts_json`) and the
 *                        narrative. NOT `defence_evidence_facts`, which holds
 *                        zero rows for all 50 analyzable disputes.
 *   disputes             outcome, submission state, and `raw_snapshot.evidenceSentOn`
 *                        — the only forwarding signal that exists.
 *   shopify_orders       payment gateway. Joined on the FULL order GID, which
 *                        is what `shopify_order_id` actually stores.
 *   gorgias_evidence_messages  approved passages, with their approval times.
 *   dispute_events       lifecycle. Full coverage on all 50 analyzable cases.
 *
 * `submission_logs` and `submission_attempts` are empty platform-wide and are
 * deliberately not queried.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { fetchCandidateRows } from "@/lib/defence/candidateVersions";
import type {
  RawDisputeRow,
  RawEventRow,
  RawGorgiasRow,
  RawPackageRow,
  SnapshotInputs,
} from "./buildSnapshot";
import type { CardNetwork } from "./taxonomy";
import type { SnapshotCaseStrength } from "./snapshotContract";

const DISPUTE_COLUMNS = `
  id, shop_id, phase, reason, network_reason_code, amount, currency_code,
  initiated_at, closed_at, final_outcome, outcome_source, submission_state,
  submitted_at, evidence_saved_to_shopify_at, due_at, dispute_evidence_gid,
  order_gid, raw_snapshot
`;

const PACKAGE_COLUMNS = `
  id, dispute_id, version, content_revision, status, submitted_at, generated_at,
  pdf_path, evidence_hash, prompt_version, validator_version, reason_code_module,
  facts_json, narrative_json, shopify_response
`;

/**
 * Card network. Shopify does not expose it on the dispute in the typed schema,
 * so absence is the norm rather than an error — UNKNOWN forms its own cohort
 * (plan §18) and is never merged with a known-network one.
 */
function resolveCardNetwork(): CardNetwork {
  return "UNKNOWN";
}

export async function loadSnapshotInputs(
  disputeId: string,
): Promise<SnapshotInputs | null> {
  const sb = getServiceClient();

  const { data: dispute } = await sb
    .from("disputes")
    .select(DISPUTE_COLUMNS)
    .eq("id", disputeId)
    .maybeSingle<RawDisputeRow>();

  if (!dispute) return null;

  // Every version for the dispute, through THE owner of version-ordered
  // `defence_packages` queries (lib/defence/candidateVersions.ts). An earlier
  // draft issued its own `.order("version")`, which is the call shape that let
  // an aborted build shadow a filed package and forfeit a live dispute.
  //
  // The submitted-only filter is applied here rather than in the query because
  // ambiguity detection needs to see every submitted row, not the newest one.
  const { rows: allVersions } = await fetchCandidateRows<RawPackageRow>(
    sb,
    disputeId,
    PACKAGE_COLUMNS,
  );
  const packages = allVersions
    .filter((p) => p.submitted_at !== null)
    .sort((a, b) => a.version - b.version);

  const { data: gorgias } = await sb
    .from("gorgias_evidence_messages")
    .select("id, dispute_id, evidence_category, review_status, approved_at, created_at, sent_at, approved_excerpt")
    .eq("dispute_id", disputeId)
    .returns<RawGorgiasRow[]>();

  const { data: events } = await sb
    .from("dispute_events")
    .select("event_type, event_at, description")
    .eq("dispute_id", disputeId)
    .order("event_at", { ascending: true })
    .returns<RawEventRow[]>();

  let paymentGateway: string | null = null;
  if (dispute.order_gid) {
    // `shopify_orders.shopify_order_id` stores the full GID, not the numeric
    // suffix. Splitting it produces zero matches on every row.
    const { data: order } = await sb
      .from("shopify_orders")
      .select("payment_gateway")
      .eq("shop_id", dispute.shop_id)
      .eq("shopify_order_id", dispute.order_gid)
      .maybeSingle<{ payment_gateway: string | null }>();
    paymentGateway = order?.payment_gateway ?? null;
  }

  return {
    dispute,
    submittedPackages: packages,
    gorgias: gorgias ?? [],
    events: events ?? [],
    paymentGateway,
    cardNetwork: resolveCardNetwork(),
    caseStrengthAtSubmission: resolveCaseStrength(packages),
  };
}

/**
 * Case strength as it stood at submission.
 *
 * There is no stored strength-at-submission column, and today's recomputed
 * strength is a different number from the one the case was filed under. Rather
 * than backfill a plausible value, this reports `not_assessed` — the snapshot's
 * job is to say "not reconstructable" rather than to fill a historical gap with
 * current data (plan §20 Phase 0).
 */
function resolveCaseStrength(_packages: RawPackageRow[]): SnapshotCaseStrength {
  return "not_assessed";
}
