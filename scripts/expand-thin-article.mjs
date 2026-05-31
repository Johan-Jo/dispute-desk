/**
 * Rebuilds thin / under-tier Resources Hub articles IN PLACE to their tier
 * floor, across all locales, by driving the deployed server route
 * /api/cron/expand-thin one content_item at a time (generation runs server-side
 * on Vercel where OPENAI + GENERATION_ENABLED live — same trigger model as
 * scripts/run-autopilot-once.mjs).
 *
 * Targets (in priority order):
 *   - explicit content_item UUIDs passed as args, OR
 *   - default: every content_item with a localization flagged
 *     migration_action='expand' (set by the noindex step / audit).
 *
 * Flags:
 *   --publish        Publish + un-noindex successful locales (default: hold for review).
 *   --limit=N        Process at most N items this run.
 *   --dry-run        Print the target list and exit without generating.
 *
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *           CRON_SECRET, and CRON_TRIGGER_URL or NEXT_PUBLIC_APP_URL
 *           (default https://disputedesk.app).
 *
 *   node scripts/expand-thin-article.mjs --dry-run
 *   node scripts/expand-thin-article.mjs --limit=1
 *   node scripts/expand-thin-article.mjs --publish
 *   node scripts/expand-thin-article.mjs <content_item_uuid> --publish
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;
const base = (process.env.CRON_TRIGGER_URL || process.env.NEXT_PUBLIC_APP_URL || "https://disputedesk.app").replace(/\/$/, "");

if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!cronSecret) {
  console.error("Missing CRON_SECRET");
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const publish = flags.has("--publish");
const dryRun = flags.has("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
const explicitIds = args.filter((a) => /^[0-9a-f-]{36}$/i.test(a));

const sb = createClient(url, key);

async function resolveTargets() {
  if (explicitIds.length > 0) return explicitIds;
  const { data, error } = await sb
    .from("content_localizations")
    .select("content_item_id")
    .eq("migration_action", "expand");
  if (error) {
    console.error("Failed to query expand targets:", error.message);
    process.exit(1);
  }
  return [...new Set((data ?? []).map((r) => r.content_item_id))];
}

async function main() {
  const targets = (await resolveTargets()).slice(0, limit);
  console.log(`Target: ${base}/api/cron/expand-thin`);
  console.log(`publish=${publish}  items=${targets.length}\n`);
  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }
  if (dryRun) {
    targets.forEach((id) => console.log(`  • ${id}`));
    console.log("\n(dry run — nothing generated)");
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const [i, id] of targets.entries()) {
    process.stdout.write(`[${i + 1}/${targets.length}] ${id} … `);
    try {
      const res = await fetch(`${base}/api/cron/expand-thin?contentItemId=${id}&publish=${publish}`, {
        headers: { Authorization: `Bearer ${cronSecret}` },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        failed += 1;
        console.log(`HTTP ${res.status} ✗ ${body ? JSON.stringify(body) : ""}`);
        continue;
      }
      const summary = (body.perLocale ?? []).map((p) => `${p.locale}:${p.status}${p.words ? `(${p.words}w)` : ""}`).join(" ");
      if (body.error) {
        failed += 1;
        console.log(`partial ✗ ${summary} — ${body.error}`);
      } else {
        ok += 1;
        console.log(`✓ ${summary} (${body.tokensUsed} tok)`);
      }
    } catch (e) {
      failed += 1;
      console.log(`✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nDone. ${ok} ok, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
