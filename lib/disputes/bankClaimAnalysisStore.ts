/**
 * Load the analysis of the dispute's bank claim for the current response
 * cycle, analysing (and storing) it on first use. Used by the claim route at
 * save time and, lazily, by the pack and letter builders — so a claim saved
 * before analysis existed is still read before the next letter.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeBankClaim, type BankClaimAnalysis } from "./bankClaimAnalysis";

export async function ensureBankClaimAnalysis(
  sb: SupabaseClient,
  disputeId: string,
  cycle: number | null | undefined,
): Promise<BankClaimAnalysis | null> {
  const { data } = await sb
    .from("dispute_bank_claims")
    .select("id, claim_text, analysis")
    .eq("dispute_id", disputeId)
    .eq("response_cycle", cycle ?? 1)
    .maybeSingle();
  if (!data) return null;
  if (data.analysis && typeof data.analysis === "object") return data.analysis as BankClaimAnalysis;
  const text = typeof data.claim_text === "string" ? data.claim_text.trim() : "";
  if (!text) return null;
  const analysis = await analyzeBankClaim(text);
  if (analysis) {
    await sb.from("dispute_bank_claims").update({ analysis }).eq("id", data.id);
  }
  return analysis;
}
