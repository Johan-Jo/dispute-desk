/**
 * Drives the Anthropic Message Batches expansion of the thin Resources Hub
 * backlog via the deployed route /api/cron/batch-expand. Batch generation runs
 * server-side on Vercel (ANTHROPIC key + Sonnet live there) at a 50% discount.
 *
 * Flow per round:
 *   1. submit  → one batch for the target set (at-floor/dedup guards applied)
 *   2. poll    → GET status until processing_status === "ended"
 *   3. ingest  → validate + save each result; collect hard-failures
 *   4. re-batch the hard-failures with validator feedback (up to --max-rounds)
 *
 * The route does ALL DB work; this script only needs CRON_SECRET + the base URL.
 *
 * Flags:
 *   --locale=de-DE,sv-SE   Restrict to these locales (default: all 6 / flagged set).
 *   --limit=N              At most N backlog items (round 1 only).
 *   --publish              Publish + un-noindex successful locales (default: hold).
 *   --model=claude-...     Generation model (default: server's Sonnet default).
 *   --max-rounds=N         Re-batch hard-failures up to N times (default 3).
 *   --poll-secs=N          Status poll interval (default 30).
 *   --max-wait-mins=N      Give up polling a batch after N minutes (default 60).
 *   <uuid> <uuid> ...      Explicit content_item ids (× locales) instead of backlog.
 *
 * Requires: CRON_SECRET, and CRON_TRIGGER_URL or NEXT_PUBLIC_APP_URL (default
 *           https://disputedesk.app).
 *
 *   node scripts/batch-expand.mjs --locale=de-DE --publish
 *   node scripts/batch-expand.mjs --publish                 # whole flagged backlog
 */
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

const cronSecret = process.env.CRON_SECRET;
const base = (process.env.CRON_TRIGGER_URL || process.env.NEXT_PUBLIC_APP_URL || "https://disputedesk.app").replace(/\/$/, "");
if (!cronSecret) {
  console.error("Missing CRON_SECRET");
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const getArg = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`${name}=`));
  return a ? a.split("=").slice(1).join("=") : dflt;
};
const publish = flags.has("--publish");
const localeArg = getArg("--locale", "");
const limit = getArg("--limit", "");
const model = getArg("--model", "");
const maxRounds = parseInt(getArg("--max-rounds", "3"), 10);
const pollSecs = parseInt(getArg("--poll-secs", "30"), 10);
const maxWaitMins = parseInt(getArg("--max-wait-mins", "60"), 10);
const itemIds = args.filter((a) => /^[0-9a-f-]{36}$/i.test(a));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const headers = { Authorization: `Bearer ${cronSecret}`, "content-type": "application/json" };

async function api(path, init) {
  const res = await fetch(`${base}/api/cron/batch-expand${path}`, { headers, ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body ? JSON.stringify(body).slice(0, 300) : "(no body)"}`);
  return body;
}

async function submitRound1() {
  const qs = new URLSearchParams({ action: "submit" });
  if (localeArg) qs.set("locale", localeArg);
  if (limit) qs.set("limit", limit);
  if (model) qs.set("model", model);
  if (itemIds.length > 0) qs.set("itemIds", itemIds.join(","));
  return api(`?${qs.toString()}`);
}

async function submitRetry(keys, extraByKey) {
  return api(`?action=submit`, {
    method: "POST",
    body: JSON.stringify({ keys, extraByKey, model: model || undefined, applyGuards: false }),
  });
}

async function pollUntilEnded(batchId) {
  const deadline = Date.now() + maxWaitMins * 60_000;
  for (;;) {
    const s = await api(`?action=status&batchId=${batchId}`);
    const c = s.request_counts || {};
    process.stdout.write(
      `    [${new Date().toISOString().slice(11, 19)}] ${s.processing_status} ` +
        `proc=${c.processing ?? "?"} ok=${c.succeeded ?? "?"} err=${c.errored ?? "?"}\n`
    );
    if (s.processing_status === "ended") return true;
    if (Date.now() > deadline) {
      console.error(`    Gave up polling after ${maxWaitMins}min. Batch ${batchId} still running server-side — re-ingest later with:\n    curl -H "Authorization: Bearer $CRON_SECRET" "${base}/api/cron/batch-expand?action=ingest&batchId=${batchId}&publish=${publish}"`);
      return false;
    }
    await sleep(pollSecs * 1000);
  }
}

async function ingest(batchId) {
  return api(`?action=ingest&batchId=${batchId}&publish=${publish}`);
}

async function main() {
  console.log(`Target: ${base}/api/cron/batch-expand`);
  console.log(`publish=${publish}  locale=${localeArg || "(all)"}  limit=${limit || "-"}  model=${model || "(server default Sonnet)"}  maxRounds=${maxRounds}\n`);

  let round = 1;
  let sub = await submitRound1();
  console.log(`Round 1: requested=${sub.requested}  skipped=${sub.skipped?.length ?? 0}  model=${sub.model}  batchId=${sub.batchId || "(none)"}`);
  if (sub.skipped?.length) {
    const byReason = {};
    for (const s of sub.skipped) { const r = s.reason.replace(/\(.*$/, "").trim(); byReason[r] = (byReason[r] || 0) + 1; }
    console.log(`  skipped breakdown: ${JSON.stringify(byReason)}`);
  }

  const totals = { updated: 0, inserted: 0, rejected: 0, failed: 0 };
  while (sub.batchId) {
    const ended = await pollUntilEnded(sub.batchId);
    if (!ended) break;
    const ing = await ingest(sub.batchId);
    const roundTotals = { updated: 0, inserted: 0, rejected: 0, failed: 0 };
    for (const o of ing.outcomes) {
      roundTotals[o.status] = (roundTotals[o.status] || 0) + 1;
      totals[o.status] = (totals[o.status] || 0) + 1;
    }
    console.log(`Round ${round} ingest: ${JSON.stringify(roundTotals)}`);
    // sample a couple of failures/rejects for visibility
    for (const o of ing.outcomes.filter((x) => x.status === "rejected" || x.status === "failed").slice(0, 4)) {
      console.log(`    ✗ ${o.key} — ${o.status}: ${(o.error || "").slice(0, 120)}`);
    }

    // Collect retryable outcomes (rejected, or failed with feedback) for a re-batch.
    const retryable = ing.outcomes.filter((o) => o.status === "rejected" || (o.status === "failed" && o.retryFeedback !== undefined));
    if (retryable.length === 0 || round >= maxRounds) {
      if (retryable.length > 0) console.log(`\n${retryable.length} still failing after ${maxRounds} rounds (left flagged for a later pass).`);
      break;
    }
    round += 1;
    const keys = retryable.map((o) => o.key);
    const extraByKey = {};
    for (const o of retryable) if (o.retryFeedback) extraByKey[o.key] = o.retryFeedback;
    console.log(`\nRound ${round}: re-batching ${keys.length} hard-failures with feedback…`);
    sub = await submitRetry(keys, extraByKey);
    console.log(`Round ${round}: requested=${sub.requested}  batchId=${sub.batchId || "(none)"}`);
  }

  console.log(`\nDone. Totals: ${JSON.stringify(totals)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
