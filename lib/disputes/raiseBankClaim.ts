/**
 * Raise the "add the bank's claim" task for a dispute that needs it, and
 * email the merchant once per dispute and response cycle.
 *
 * Called by the effects dispatcher on every transition that can make a
 * dispute start needing the claim (opened, status/deadline change, new
 * response cycle) and by the one-off backfill. Idempotent: it re-reads the
 * row, does nothing once the claim is answered for the current cycle, and
 * the email is claimed through `withEffectDedup` on a per-cycle key, so the
 * webhook and cron paths cannot both send it.
 *
 * lib/disputes/bankClaim.ts has the rule; plan docs/plans/bank-claim-capture.plan.md.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/server";
import {
  BANK_CLAIM_DISPUTE_COLUMNS,
  bankClaimInputFromRow,
  bankClaimTrigger,
  loadBankClaimAnswer,
  markBankClaimNeeded,
  type BankClaimTrigger,
} from "./bankClaim";
import { withEffectDedup } from "./dispatchOnce";
import { sendBankClaimNeededAlert } from "@/lib/email/sendBankClaimNeededAlert";

export interface RaiseBankClaimResult {
  needed: boolean;
  trigger: BankClaimTrigger | null;
  cycle: number;
  answered: boolean;
  marked: boolean;
  emailed: boolean;
}

/**
 * Kill switch for the merchant email, OFF unless explicitly enabled. Held
 * off at launch (2026-09-27) so the maintainer can verify the card, the task
 * and the filing gate on live disputes before any merchant is emailed. The
 * task and the gate run regardless. The dedupe claim is NOT burned while
 * off, so enabling it later still sends the email on the next transition
 * (or via scripts/shopify/raise-bank-claims.ts --apply --email).
 */
export function bankClaimEmailsEnabled(): boolean {
  return process.env.BANK_CLAIM_EMAILS_ENABLED === "true";
}

export function bankClaimEmailKey(disputeId: string, cycle: number): string {
  return `${disputeId}:BANK_CLAIM_NEEDED:c${cycle}`;
}

export async function raiseBankClaimIfNeeded(args: {
  shopId: string;
  disputeId: string;
  /** First-sync backfill / historical import: raise the task, send nothing. */
  suppressEmail?: boolean;
  client?: SupabaseClient;
}): Promise<RaiseBankClaimResult> {
  const sb = args.client ?? getServiceClient();
  const { data: row } = await sb
    .from("disputes")
    .select(BANK_CLAIM_DISPUTE_COLUMNS)
    .eq("id", args.disputeId)
    .maybeSingle();
  const none: RaiseBankClaimResult = {
    needed: false,
    trigger: null,
    cycle: 1,
    answered: false,
    marked: false,
    emailed: false,
  };
  if (!row) return none;

  const input = bankClaimInputFromRow(row as Record<string, unknown>);
  const cycle = input.responseCycle ?? 1;
  const trigger = bankClaimTrigger(input);
  if (!trigger) return { ...none, cycle };

  const answer = await loadBankClaimAnswer(sb, args.disputeId, cycle);
  if (answer) return { ...none, needed: true, trigger, cycle, answered: true };

  const marked = await markBankClaimNeeded(sb, args.disputeId, { trigger, cycle });

  let emailed = false;
  if (!args.suppressEmail && bankClaimEmailsEnabled()) {
    const dedup = await withEffectDedup({
      shopId: args.shopId,
      disputeId: args.disputeId,
      eventKey: bankClaimEmailKey(args.disputeId, cycle),
      effectName: "send_bank_claim_needed_email",
      context: { trigger, cycle },
      client: sb,
      effect: () => sendBankClaimNeededAlert({ shopId: args.shopId, disputeId: args.disputeId, trigger }),
    });
    emailed = dedup.ran && dedup.result?.sent === true;
  }

  return { needed: true, trigger, cycle, answered: false, marked, emailed };
}
