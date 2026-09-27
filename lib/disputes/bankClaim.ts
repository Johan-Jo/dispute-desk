/**
 * The bank's claim — what the card-issuing bank says the buyer is disputing.
 *
 * Shopify shows it (the "issuer claim") only in Shopify Admin, on the order's
 * chargeback details. The Admin API has no field for it (verified against
 * `ShopifyPaymentsDispute`, `reasonDetails` and `ShopifyPaymentsDisputeEvidence`,
 * 2026-09-27). For most disputes the reason code is enough to build a
 * response. For two it is not, and a letter built without the claim answers a
 * question nobody asked (Mein Maison #99142: reopened, reason changed from
 * `fraudulent` to `general`, letter fell back to "Unmapped chargeback claim"):
 *
 *   - a REOPENED dispute (response cycle ≥ 2): Shopify put an answered
 *     dispute back to needs_response, so the earlier answer did not settle
 *     it and the new round answers something we cannot see;
 *   - a GENERAL dispute with no network reason code: Shopify's own advice is
 *     to find out what the complaint is before responding.
 *
 * So we ask the merchant to copy it across. Until they answer (or confirm
 * Shopify shows no claim), the dispute is never filed automatically.
 *
 * Plan: docs/plans/bank-claim-capture.plan.md.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRealDeadline } from "./responseCycle";

export const BANK_CLAIM_MAX_TEXT = 8000;

export type BankClaimTrigger = "reopened" | "general_reason";

export interface BankClaimDisputeInput {
  status: string | null;
  dueAt: string | null;
  closedAt?: string | null;
  finalOutcome?: string | null;
  responseCycle: number | null | undefined;
  reason: string | null;
  networkReasonCode: string | null | undefined;
}

/** Why the claim is needed, or null when it is not. */
export function bankClaimTrigger(d: BankClaimDisputeInput): BankClaimTrigger | null {
  if (d.closedAt || (d.finalOutcome && d.finalOutcome !== "unknown")) return null;
  if (d.status !== "needs_response") return null;
  if (!hasRealDeadline(d.dueAt)) return null;
  if (new Date(d.dueAt!).getTime() <= Date.now()) return null;
  if ((d.responseCycle ?? 1) >= 2) return "reopened";
  const reason = (d.reason ?? "").toUpperCase();
  if (reason === "GENERAL" && !d.networkReasonCode) return "general_reason";
  return null;
}

export function needsBankClaim(d: BankClaimDisputeInput): boolean {
  return bankClaimTrigger(d) !== null;
}

export interface BankClaimAnswer {
  /** Pasted text, or the text read from the uploaded file. */
  text: string | null;
  noClaimShown: boolean;
  cycle: number;
  answeredAt: string;
  /** The uploaded claim file, when the merchant uploaded one. */
  fileName: string | null;
  fileSize: number | null;
  /** How `text` was obtained: pasted, read from a text file, or transcribed. */
  textSource: "pasted" | "file_text" | "file_ai" | null;
}

/**
 * The merchant's answer for the dispute's CURRENT response cycle. Stored in
 * `dispute_bank_claims` (one row per dispute and cycle), not in
 * evidence_items: pack rebuilds delete and re-nest manual items. A claim
 * captured for an earlier round never counts for a later one — a reopen
 * means the bank sent something new.
 */
export async function loadBankClaimAnswer(
  sb: SupabaseClient,
  disputeId: string,
  cycle: number | null | undefined,
): Promise<BankClaimAnswer | null> {
  const { data } = await sb
    .from("dispute_bank_claims")
    .select("claim_text, no_claim_shown, response_cycle, answered_at, file_path, file_name, file_size, text_source")
    .eq("dispute_id", disputeId)
    .eq("response_cycle", cycle ?? 1)
    .maybeSingle();
  if (!data) return null;
  const text = typeof data.claim_text === "string" && data.claim_text.trim() ? data.claim_text : null;
  const noClaimShown = data.no_claim_shown === true;
  // An uploaded file is an answer even when we could not read text from it.
  const hasFile = typeof data.file_path === "string" && data.file_path.length > 0;
  if (!text && !noClaimShown && !hasFile) return null;
  return {
    text,
    noClaimShown,
    cycle: Number(data.response_cycle ?? 1),
    answeredAt: String(data.answered_at ?? ""),
    fileName: hasFile ? ((data.file_name as string | null) ?? null) : null,
    fileSize: hasFile ? ((data.file_size as number | null) ?? null) : null,
    textSource: (data.text_source as BankClaimAnswer["textSource"]) ?? null,
  };
}

/**
 * Filing gate: true when the dispute needs the bank's claim for its current
 * cycle and the merchant has not given it. Save worker, deadline cron and
 * the approve route all call this.
 */
export async function bankClaimBlocksFiling(
  sb: SupabaseClient,
  disputeId: string,
  d: BankClaimDisputeInput,
): Promise<boolean> {
  if (!needsBankClaim(d)) return false;
  const answer = await loadBankClaimAnswer(sb, disputeId, d.responseCycle);
  return answer === null;
}

const BANK_CLAIM_NEEDED = "bank_claim_needed";

/**
 * Raise the merchant task. Only when no other attention reason is set: a
 * billing or build gate must be fixed first and keeps its own banner. The
 * filing gate (`bankClaimBlocksFiling`) holds regardless of the banner.
 */
export async function markBankClaimNeeded(
  sb: SupabaseClient,
  disputeId: string,
  payload: { trigger: BankClaimTrigger; cycle: number },
): Promise<boolean> {
  const { data } = await sb
    .from("disputes")
    .update({
      needs_attention: true,
      attention_reason: BANK_CLAIM_NEEDED,
      attention_payload: payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", disputeId)
    .or(`attention_reason.is.null,attention_reason.eq.${BANK_CLAIM_NEEDED}`)
    .select("id");
  return (data ?? []).length > 0;
}

export async function clearBankClaimNeeded(
  sb: SupabaseClient,
  disputeId: string,
): Promise<void> {
  await sb
    .from("disputes")
    .update({
      needs_attention: false,
      attention_reason: null,
      attention_payload: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", disputeId)
    .eq("attention_reason", BANK_CLAIM_NEEDED);
}

/** Dispute columns every caller of the predicate needs. */
export const BANK_CLAIM_DISPUTE_COLUMNS =
  "status, due_at, closed_at, final_outcome, response_cycle, reason, network_reason_code";

export function bankClaimInputFromRow(row: Record<string, unknown>): BankClaimDisputeInput {
  return {
    status: (row.status as string | null) ?? null,
    dueAt: (row.due_at as string | null) ?? null,
    closedAt: (row.closed_at as string | null) ?? null,
    finalOutcome: (row.final_outcome as string | null) ?? null,
    responseCycle: (row.response_cycle as number | null) ?? 1,
    reason: (row.reason as string | null) ?? null,
    networkReasonCode: (row.network_reason_code as string | null) ?? null,
  };
}
