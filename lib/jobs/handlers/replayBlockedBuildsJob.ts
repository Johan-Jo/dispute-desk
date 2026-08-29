/**
 * replay_blocked_builds — re-run the automation pipeline for a shop's
 * still-actionable disputes after pack credits arrive.
 *
 * Enqueued by `grantCredits` (the single chokepoint every credit passes
 * through). See `lib/billing/replayBlockedBuilds.ts` for why a quota-blocked
 * dispute never retries on its own.
 */

import type { ClaimedJob } from "@/lib/jobs/claimJobs";
import { replayBlockedBuilds } from "@/lib/billing/replayBlockedBuilds";

export async function handleReplayBlockedBuilds(job: ClaimedJob): Promise<void> {
  const summary = await replayBlockedBuilds(job.shopId);

  if (summary.errors.length) {
    console.error(
      `[replay_blocked_builds] shop=${job.shopId} ` +
        `candidates=${summary.candidates} enqueued=${summary.enqueued} ` +
        `errors=${summary.errors.length}: ${summary.errors.slice(0, 5).join("; ")}`,
    );
  }

  if (summary.capped) {
    console.warn(
      `[replay_blocked_builds] shop=${job.shopId} hit the candidate cap — ` +
        `more blocked disputes may remain unbuilt.`,
    );
  }
}
