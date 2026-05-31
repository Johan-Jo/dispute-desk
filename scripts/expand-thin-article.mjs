/**
 * Rebuilds thin / under-tier Resources Hub articles IN PLACE to their tier
 * floor by driving the deployed server route /api/cron/expand-thin. Generation
 * runs server-side on Vercel (OPENAI + GENERATION_ENABLED live there) — same
 * trigger model as scripts/run-autopilot-once.mjs.
 *
 * To stay under the OpenAI org TPM cap, this client generates ONE LOCALE PER
 * CALL and paces between calls (parallel 6-locale generation 429s on low
 * tiers). Each locale is retried on a 429 with escalating backoff.
 *
 * Targets (priority order):
 *   - explicit content_item UUIDs passed as args, OR
 *   - default: every content_item with a localization flagged migration_action='expand'.
 *
 * Flags:
 *   --locale=en-US   Only regenerate this locale (use for English-first verification).
 *                    Comma-separated for a subset; omit for all 6 hub locales.
 *   --publish        Publish + un-noindex successful locales (default: hold for review).
 *   --limit=N        Process at most N items this run.
 *   --pace-ms=N      Delay between locale calls (default 20000).
 *   --dry-run        Print the target list and exit without generating.
 *
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *           CRON_SECRET, and CRON_TRIGGER_URL or NEXT_PUBLIC_APP_URL (default https://disputedesk.app).
 *
 *   node scripts/expand-thin-article.mjs --dry-run
 *   node scripts/expand-thin-article.mjs <uuid> --locale=en-US        # English-first check
 *   node scripts/expand-thin-article.mjs --limit=1                     # one item, all 6 locales
 *   node scripts/expand-thin-article.mjs --publish
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

const HUB_LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const publish = flags.has("--publish");
const dryRun = flags.has("--dry-run");
const getArg = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`${name}=`));
  return a ? a.split("=").slice(1).join("=") : dflt;
};
const limit = parseInt(getArg("--limit", "Infinity"), 10) || Infinity;
const paceMs = parseInt(getArg("--pace-ms", "20000"), 10);
const localeArg = getArg("--locale", "");
const locales = localeArg ? localeArg.split(",").map((s) => s.trim()).filter(Boolean) : HUB_LOCALES;
const explicitIds = args.filter((a) => /^[0-9a-f-]{36}$/i.test(a));

const sb = createClient(url, key);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveTargets() {
  if (explicitIds.length > 0) return explicitIds;
  const { data, error } = await sb.from("content_localizations").select("content_item_id").eq("migration_action", "expand");
  if (error) {
    console.error("Failed to query expand targets:", error.message);
    process.exit(1);
  }
  return [...new Set((data ?? []).map((r) => r.content_item_id))];
}

const is429 = (locResult) => typeof locResult?.error === "string" && /\b429\b|rate limit/i.test(locResult.error);

async function regenLocale(itemId, locale) {
  // Up to 3 attempts, escalating backoff on 429.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch(
      `${base}/api/cron/expand-thin?contentItemId=${itemId}&locale=${locale}&publish=${publish}`,
      { headers: { Authorization: `Bearer ${cronSecret}` } }
    );
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return { locale, status: "failed", error: `HTTP ${res.status}` };
    const lr = (body.perLocale ?? [])[0] ?? { status: "failed", error: body.error ?? "no result" };
    if (lr.status !== "failed") return lr;
    if (is429(lr) && attempt < 3) {
      const wait = attempt * 30000;
      process.stdout.write(`(429, retry in ${wait / 1000}s) `);
      await sleep(wait);
      continue;
    }
    return lr;
  }
  return { locale, status: "failed", error: "exhausted retries" };
}

async function main() {
  const targets = (await resolveTargets()).slice(0, limit);
  console.log(`Target: ${base}/api/cron/expand-thin`);
  console.log(`publish=${publish}  locales=[${locales.join(",")}]  items=${targets.length}  pace=${paceMs}ms\n`);
  if (targets.length === 0) return console.log("Nothing to do.");
  if (dryRun) {
    targets.forEach((id) => console.log(`  • ${id}`));
    return console.log("\n(dry run — nothing generated)");
  }

  let okItems = 0;
  let failItems = 0;
  for (const [i, id] of targets.entries()) {
    console.log(`[${i + 1}/${targets.length}] ${id}`);
    let itemOk = true;
    for (const [j, loc] of locales.entries()) {
      process.stdout.write(`    ${loc} … `);
      const lr = await regenLocale(id, loc);
      if (lr.status === "failed") {
        itemOk = false;
        console.log(`✗ ${(lr.error || "").slice(0, 160)}`);
      } else {
        console.log(`✓ ${lr.status}${lr.words ? ` (${lr.words}w)` : ""}`);
      }
      if (j < locales.length - 1) await sleep(paceMs);
    }
    itemOk ? (okItems += 1) : (failItems += 1);
  }
  console.log(`\nDone. ${okItems} items fully ok, ${failItems} with at least one failed locale.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
