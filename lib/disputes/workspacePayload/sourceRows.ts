/**
 * The source rows the workspace payload is ENRICHED from (single-source plan
 * 3.1). `EnrichSourceRows` has exactly one field per enriched output, so the
 * fixtures a test freezes are the same shape the route hands to
 * `enrichWorkspacePayload` - there is no second assembly path.
 *
 * Both the workspace route and `scripts/fixtures/capture-workspace-fixture.mjs`
 * call `loadEnrichSourceRows`. Read-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { pickAutomationAction } from "@/lib/rules/pickAutomationAction";
import { normalizeMode, type AutomationMode } from "@/lib/rules/normalizeMode";
import type { Rule } from "@/lib/rules/types";

export interface EnrichSourceRows {
  /** `disputes.evidence_saved_to_shopify_at` - the dispute row's own transmission stamp. */
  evidenceSavedToShopifyAt: string | null;
  /** The automation mode the route resolves (rules first, else the last `rule_applied` audit event). */
  automationMode: AutomationMode | null;
  /** Whether the server could read `defence_packages` for this dispute (`gatherArtifacts.ts` `readOk`). */
  assessmentReadOk: boolean;
  /** The submitted defence package's filing date and facts; null when none was submitted. */
  outcomeInputs: { submittedAt: string | null; facts: unknown } | null;
}

export async function loadEnrichSourceRows(
  sb: SupabaseClient,
  disputeId: string,
): Promise<EnrichSourceRows> {
  const { data: row } = await sb
    .from("disputes")
    .select("id, shop_id, reason, status, amount, phase, evidence_saved_to_shopify_at")
    .eq("id", disputeId)
    .maybeSingle();
  const shopId = (row?.shop_id as string | undefined) ?? null;

  let automationMode: AutomationMode | null = null;
  if (row && shopId) {
    const { data: ruleRows } = await sb
      .from("rules")
      .select("*")
      .eq("shop_id", shopId)
      .eq("enabled", true)
      .order("priority", { ascending: true });
    automationMode = pickAutomationAction((ruleRows ?? []) as Rule[], {
      id: row.id as string,
      shop_id: shopId,
      reason: (row.reason as string | null) ?? null,
      status: (row.status as string | null) ?? null,
      amount: row.amount == null ? null : Number(row.amount),
      phase: row.phase === "inquiry" || row.phase === "chargeback" ? row.phase : null,
    }).action.mode;
  }
  if (automationMode === null) {
    const { data: applied } = await sb
      .from("audit_events")
      .select("event_payload")
      .eq("dispute_id", disputeId)
      .eq("event_type", "rule_applied")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const raw = (applied?.event_payload as { resulting_action?: { mode?: string } } | undefined)
      ?.resulting_action?.mode;
    automationMode = raw != null ? normalizeMode(raw) : null;
  }

  let assessmentReadOk = true;
  let outcomeInputs: EnrichSourceRows["outcomeInputs"] = null;
  if (shopId) {
    const { error: readErr } = await sb
      .from("defence_packages")
      .select("id")
      .eq("shop_id", shopId)
      .eq("dispute_id", disputeId)
      .limit(1);
    assessmentReadOk = !readErr;

    const { data: pack } = await sb
      .from("evidence_packs")
      .select("id")
      .eq("dispute_id", disputeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pack?.id) {
      const { data: submitted } = await sb
        .from("defence_packages")
        .select("submitted_at, facts_json")
        .eq("source_pack_id", pack.id as string)
        .eq("shop_id", shopId)
        .eq("status", "submitted")
        .maybeSingle();
      if (submitted) {
        outcomeInputs = {
          submittedAt: (submitted.submitted_at as string | null) ?? null,
          facts: submitted.facts_json ?? null,
        };
      }
    }
  }

  return {
    evidenceSavedToShopifyAt: (row?.evidence_saved_to_shopify_at as string | null) ?? null,
    automationMode,
    assessmentReadOk,
    outcomeInputs,
  };
}
