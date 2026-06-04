import type { SupabaseClient } from "@supabase/supabase-js";
import type { SignalAnalysisOutput } from "./schema";

const MIN_CONFIDENCE_FOR_IMMEDIATE = 5;
const CATEGORY_COOLDOWN_HOURS = 4;
const CLUSTER_COOLDOWN_HOURS = 24;
const CIRCUIT_BREAKER_LIMIT = 10;
const CIRCUIT_BREAKER_WINDOW_HOURS = 1;
const MIGRATION_DAILY_CAP = 5;

export type AlertKind = "immediate" | "digest" | "none";

export interface AlertDecisionInput {
  analysis: Pick<
    SignalAnalysisOutput,
    "category" | "signal_score" | "source_confidence_score" | "dispute_relevance"
  >;
  platform: string;
  subreddit: string | null;
  cluster_key: string | null;
}

export interface AlertDecision {
  kind: AlertKind;
  category_dedup_key: string;
  cluster_dedup_key: string | null;
  category_cooldown_hours: number | null;
  cluster_cooldown_hours: number;
  reason: string;
}

export function decideAlert(input: AlertDecisionInput): AlertDecision {
  const { analysis, platform, subreddit, cluster_key } = input;
  const subKey = subreddit ?? "_";
  const category_dedup_key = `immediate:${analysis.category}:${platform}:${subKey}`;
  const cluster_dedup_key = cluster_key
    ? `immediate:cluster:${cluster_key}`
    : null;

  const baseDecision = (
    kind: AlertKind,
    reason: string,
    categoryCooldown: number | null
  ): AlertDecision => ({
    kind,
    category_dedup_key,
    cluster_dedup_key,
    category_cooldown_hours: categoryCooldown,
    cluster_cooldown_hours: CLUSTER_COOLDOWN_HOURS,
    reason,
  });

  if (analysis.source_confidence_score < MIN_CONFIDENCE_FOR_IMMEDIATE) {
    return baseDecision("digest", "below_confidence_gate", null);
  }

  // Thresholds lowered 2026-05-30 (was migration≥8 / transparency≥8 /
  // reserve_fear≥9 / competitor≥8). At observed volume nothing cleared the
  // old bar for a week despite a healthy pipeline. Dedup cooldowns
  // (CATEGORY_COOLDOWN_HOURS / CLUSTER_COOLDOWN_HOURS) and the circuit
  // breaker still cap email volume, so a lower entry bar surfaces real pain
  // without flooding.
  if (analysis.category === "migration_intent" && analysis.signal_score >= 6) {
    return baseDecision("immediate", "migration_intent", null);
  }
  if (
    analysis.category === "transparency_frustration" &&
    analysis.signal_score >= 6
  ) {
    return baseDecision(
      "immediate",
      "transparency_frustration",
      CATEGORY_COOLDOWN_HOURS
    );
  }
  if (analysis.category === "reserve_fear" && analysis.signal_score >= 7) {
    return baseDecision("immediate", "reserve_fear", CATEGORY_COOLDOWN_HOURS);
  }
  if (
    analysis.category === "competitor_frustration" &&
    analysis.signal_score >= 6
  ) {
    return baseDecision(
      "immediate",
      "competitor_frustration",
      CATEGORY_COOLDOWN_HOURS
    );
  }

  // Dispute-pain catch-all (added 2026-06-04). The four category rules above
  // target switching / competitor intent, but DisputeDesk's core ICP — a
  // merchant actively in chargeback/dispute pain — usually classifies as
  // operational_overload / evidence_confusion / general_discussion, which
  // never alerted. Fire on ANY dispute-relevant, high-signal item regardless of
  // category. merchant_relevance is already enforced by the caller and
  // confidence ≥ 5 by the gate above, so this is "a real merchant, in dispute
  // pain, strong signal". Per-category cooldown + cluster cooldown + circuit
  // breaker still bound volume.
  if (analysis.dispute_relevance && analysis.signal_score >= 7) {
    return baseDecision(
      "immediate",
      "dispute_pain_high_signal",
      CATEGORY_COOLDOWN_HOURS
    );
  }

  return baseDecision("digest", "no_immediate_rule_matched", null);
}

export async function circuitBreakerTripped(
  sb: SupabaseClient
): Promise<boolean> {
  const since = new Date(
    Date.now() - CIRCUIT_BREAKER_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString();
  const { count } = await sb
    .from("signal_alerts")
    .select("*", { count: "exact", head: true })
    .eq("alert_type", "immediate")
    .gt("sent_at", since);
  return (count ?? 0) >= CIRCUIT_BREAKER_LIMIT;
}

export async function checkCategoryDedup(
  sb: SupabaseClient,
  decision: AlertDecision
): Promise<boolean> {
  if (decision.category_cooldown_hours == null) return false;
  const since = new Date(
    Date.now() - decision.category_cooldown_hours * 60 * 60 * 1000
  ).toISOString();
  const { count } = await sb
    .from("signal_alerts")
    .select("*", { count: "exact", head: true })
    .eq("dedup_key", decision.category_dedup_key)
    .gt("sent_at", since);
  return (count ?? 0) > 0;
}

export async function checkClusterDedup(
  sb: SupabaseClient,
  decision: AlertDecision
): Promise<boolean> {
  if (!decision.cluster_dedup_key) return false;
  const since = new Date(
    Date.now() - decision.cluster_cooldown_hours * 60 * 60 * 1000
  ).toISOString();
  const { count } = await sb
    .from("signal_alerts")
    .select("*", { count: "exact", head: true })
    .eq("cluster_dedup_key", decision.cluster_dedup_key)
    .gt("sent_at", since);
  return (count ?? 0) > 0;
}

export async function migrationCapReached(
  sb: SupabaseClient
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await sb
    .from("signal_alerts")
    .select("*", { count: "exact", head: true })
    .eq("alert_type", "immediate")
    .eq("category", "migration_intent")
    .gt("sent_at", since);
  return (count ?? 0) >= MIGRATION_DAILY_CAP;
}
