/**
 * Job-queue priority tiers.
 *
 * `claim_jobs` orders by `priority ASC, run_at ASC` with a hard cap of
 * 1 running job per shop and one worker tick every 2 minutes — so a
 * shop's queue drains at ~1 job / 2 min. Any bulk batch (backfill,
 * cron sweep) enqueued at the same priority as merchant-clicked work
 * therefore starves the merchant for `2 × queue-length` minutes
 * (observed 2026-07-22: a 40-pack Blume Box backfill chained 40 defence
 * rebuilds and pinned a merchant "Rebuild defence package" click behind
 * ~1.5 h of queue — the UI spinner "never terminated").
 *
 * Tiers:
 *   - INTERACTIVE (20): a merchant clicked something and is watching a
 *     spinner. Regenerate routes, manual pack builds, cardholder
 *     acknowledgements. Jobs chained FROM an interactive job inherit
 *     its priority (buildPackJob → maybeEnqueueDefencePackage).
 *   - DEFAULT (100): webhook-driven pipeline work (dispute sync →
 *     build_pack), cron sweeps. The `jobs.priority` column default.
 *   - Bulk/ops backfills (ad-hoc SQL under scripts/sql/) MUST enqueue
 *     at >= 500 so they never starve the tiers above.
 *
 * Values below 20 are reserved for manual ops unblocking (bumping a
 * specific stuck job to the front of the line).
 */
export const JOB_PRIORITY_INTERACTIVE = 20;
export const JOB_PRIORITY_DEFAULT = 100;
