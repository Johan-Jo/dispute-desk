/**
 * LSE-4 retention job: hard-delete checkout_sessions rows past their
 * retention_expires_at (default = creation + 18 months).
 *
 * Called nightly by the existing cron infrastructure. Idempotent and
 * cheap: a single DELETE with an indexed predicate.
 */

import { getServiceClient } from "@/lib/supabase/server";

export interface ExpireSessionsResult {
  deleted: number;
  ran_at: string;
}

export async function expireCheckoutSessions(): Promise<ExpireSessionsResult> {
  const sb = getServiceClient();
  const cutoff = new Date().toISOString();
  const { count, error } = await sb
    .from("checkout_sessions")
    .delete({ count: "exact" })
    .lt("retention_expires_at", cutoff);

  if (error) {
    console.warn("[expireCheckoutSessions] failed:", error.message);
    return { deleted: 0, ran_at: cutoff };
  }
  return { deleted: count ?? 0, ran_at: cutoff };
}
