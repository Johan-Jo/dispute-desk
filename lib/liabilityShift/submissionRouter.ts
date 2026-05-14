/**
 * LSE-2 submission router.
 *
 * Takes a qualifying CE 3.0 verdict and routes the package through the
 * channels available today:
 *   1. Shopify dispute evidence API (best-effort) — uncategorized_text
 *      summary + uncategorized_file PDF attachment
 *   2. Manual acquirer handoff — generate the package, expose a download
 *      link, expect the merchant to upload to their acquirer's VROL portal
 *
 * Both channels run by default in v1 — the data tells us which actually
 * wins (`submission_logs.final_outcome`). Direct Verifi / Ethoca paths
 * (LSE-6) are stubs in the schema and not invoked here.
 *
 * Never auto-claims "CE 3.0 submitted to Visa" — see LSE-2 epic
 * acceptance criteria. We only claim "package generated and attached
 * via the Shopify dispute API."
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { CE30Result } from "./types";

export type SubmissionChannel =
  | "shopify_dispute_api"
  | "manual_acquirer"
  | "verifi"
  | "ethoca";

export interface SubmissionRouterInput {
  shopId: string;
  disputeId: string;
  evidencePackId: string;
  verdict: CE30Result;
  /** When false, only manual handoff is set up; no Shopify API call. */
  autoSubmitViaShopify: boolean;
  /** When false, the merchant UI hides the acquirer instructions. */
  showManualHandoff: boolean;
}

export interface SubmissionRouterResult {
  channelsActivated: SubmissionChannel[];
  manualHandoffOffered: boolean;
  notes: string[];
}

/**
 * Decide channel activation per shop settings + verdict. Does NOT
 * actually submit to Shopify — that's done by the existing
 * saveToShopifyJob, which the caller can re-trigger after we mark the
 * pack as CE-3.0-flavored. We just record the planned routing as
 * submission_logs rows in `pending` state.
 */
export async function activateSubmissionChannels(
  input: SubmissionRouterInput,
): Promise<SubmissionRouterResult> {
  const channelsActivated: SubmissionChannel[] = [];
  const notes: string[] = [];

  // Coverage gate (per CLAUDE.md non-negotiables): never auto-submit a
  // pack that's been short-circuited as covered. Callers gate on this
  // before reaching the router; we don't recompute coverage here.

  // Channel 1: Shopify dispute API best-effort.
  if (
    input.autoSubmitViaShopify &&
    (input.verdict.verdict === "qualifies" ||
      input.verdict.verdict === "qualifies_network_prequalified" ||
      input.verdict.verdict === "qualifies_via_initial_billing")
  ) {
    await upsertSubmissionLog({
      shopId: input.shopId,
      disputeId: input.disputeId,
      evidencePackId: input.evidencePackId,
      channel: "shopify_dispute_api",
      finalOutcome: "pending",
      notes:
        "CE 3.0 package attached via Shopify dispute evidence API (best-effort routing).",
    });
    channelsActivated.push("shopify_dispute_api");
    notes.push("shopify_dispute_api:queued");
  }

  // Channel 2: Manual acquirer handoff — always offered when
  // `showManualHandoff` is enabled. We don't auto-do anything; we just
  // surface the package + instructions in the UI. The merchant marks
  // the submission via POST /api/packs/:id/mark-submitted.
  const manualHandoffOffered =
    input.showManualHandoff &&
    (input.verdict.verdict === "qualifies" ||
      input.verdict.verdict === "qualifies_network_prequalified" ||
      input.verdict.verdict === "qualifies_via_initial_billing");

  return { channelsActivated, manualHandoffOffered, notes };
}

interface UpsertSubmissionLogInput {
  shopId: string;
  disputeId: string;
  evidencePackId: string;
  channel: SubmissionChannel;
  finalOutcome: "pending" | "won" | "lost" | "withdrawn" | "unknown";
  confirmationId?: string;
  rawResponse?: unknown;
  notes?: string;
}

export async function upsertSubmissionLog(
  input: UpsertSubmissionLogInput,
): Promise<{ ok: boolean; error?: string }> {
  const sb = getServiceClient();
  const { error } = await sb.from("submission_logs").upsert(
    {
      shop_id: input.shopId,
      dispute_id: input.disputeId,
      evidence_pack_id: input.evidencePackId,
      channel: input.channel,
      submitted_at: new Date().toISOString(),
      confirmation_id: input.confirmationId ?? null,
      raw_response: input.rawResponse ?? null,
      final_outcome: input.finalOutcome,
      notes: input.notes ?? null,
    },
    { onConflict: "evidence_pack_id,channel" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Record an outcome update from the merchant or from a Shopify webhook
 * (e.g. dispute closed_at + final status). Called from the existing
 * sync pipeline when a dispute reaches a terminal status.
 */
export async function recordOutcomeForPack(
  input: {
    evidencePackId: string;
    outcome: "won" | "lost" | "withdrawn" | "unknown";
  },
): Promise<void> {
  const sb = getServiceClient();
  const now = new Date().toISOString();
  await sb
    .from("submission_logs")
    .update({
      final_outcome: input.outcome,
      outcome_recorded_at: now,
    })
    .eq("evidence_pack_id", input.evidencePackId)
    .eq("final_outcome", "pending");
}
