/**
 * Generates the master rewrite plan from the current hub state. Read-only —
 * does not modify anything. Run before any bulk action so the user sees
 * exactly what would happen.
 *
 * Output:
 *   1. Total articles in scope (by locale)
 *   2. Per-article action recommendation: keep / expand / merge / redirect /
 *      noindex / promote_a / rewrite (mirrors the audit script's categories)
 *   3. Cost projection for full hub regen × 6 locales
 *
 * Usage: node scripts/hub-rewrite-plan.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { resolve } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALL_LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];

function htmlToText(html) {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function wordCount(t) {
  return t.split(/\s+/).filter(Boolean).length;
}

const HYPE_TITLE_PATTERNS = [
  /^mastering\b/i,
  /^navigating\b/i,
  /^understanding\b/i,
  /^complete guide to\b/i,
  /^the ultimate guide\b/i,
  /^effective strategies for\b/i,
  /^a comprehensive guide\b/i,
  /\btactical approaches\b/i,
];

function classifyArticle(loc) {
  const html = loc.body_json?.mainHtml ?? "";
  const wc = wordCount(htmlToText(html));
  const titleHype = HYPE_TITLE_PATTERNS.some((re) => re.test(loc.title ?? ""));
  const tooThin = wc < 200;

  if (loc.is_excluded_from_sitemap || loc.quality_status === "excluded") {
    return { action: "already-excluded", reason: "is_excluded_from_sitemap" };
  }
  if (loc.redirect_to_localization_id) {
    return { action: "already-redirected", reason: "has redirect target" };
  }
  if (tooThin) {
    return { action: "redirect-or-delete", reason: `${wc}w — too thin to salvage` };
  }
  if (titleHype) {
    return { action: "rewrite", reason: `hype title (${loc.title})` };
  }
  if (wc < 600) {
    return { action: "rewrite", reason: `${wc}w — under merchant-decision-page threshold` };
  }
  return { action: "keep-or-revise", reason: `${wc}w — review for merchant-decision-page fit` };
}

console.log("Hub rewrite plan — current state\n");

// Pull all en-US published localizations as the source of truth for which articles exist.
const { data: locs, error } = await sb
  .from("content_localizations")
  .select(
    "id, content_item_id, locale, route_kind, slug, title, body_json, is_excluded_from_sitemap, quality_status, redirect_to_localization_id, content_items!inner(id, primary_pillar, content_type, workflow_status)"
  )
  .eq("locale", "en-US")
  .eq("content_items.workflow_status", "published");

if (error) {
  console.error(error.message);
  process.exit(1);
}

const articles = (locs ?? []).map((l) => {
  const item = Array.isArray(l.content_items) ? l.content_items[0] : l.content_items;
  return {
    locId: l.id,
    contentItemId: l.content_item_id,
    slug: l.slug,
    title: l.title,
    pillar: item?.primary_pillar,
    routeKind: l.route_kind,
    body_json: l.body_json,
    is_excluded_from_sitemap: l.is_excluded_from_sitemap,
    quality_status: l.quality_status,
    redirect_to_localization_id: l.redirect_to_localization_id,
  };
});

const buckets = {
  "already-excluded": [],
  "already-redirected": [],
  "redirect-or-delete": [],
  rewrite: [],
  "keep-or-revise": [],
};

for (const a of articles) {
  const c = classifyArticle(a);
  buckets[c.action].push({ ...a, reason: c.reason });
}

console.log(`Total published en-US articles: ${articles.length}\n`);
console.log("BUCKET COUNTS:");
for (const [bucket, items] of Object.entries(buckets)) {
  console.log(`  ${bucket.padEnd(20)} ${items.length}`);
}

console.log(`\n── REWRITE CANDIDATES (${buckets.rewrite.length}) ──`);
for (const a of buckets.rewrite.slice(0, 20)) {
  console.log(`  - ${a.slug}  [${a.pillar}/${a.routeKind}]`);
  console.log(`      reason: ${a.reason}`);
  console.log(`      title:  ${a.title}`);
}
if (buckets.rewrite.length > 20) {
  console.log(`  … and ${buckets.rewrite.length - 20} more`);
}

console.log(`\n── REDIRECT/DELETE CANDIDATES (${buckets["redirect-or-delete"].length}) ──`);
for (const a of buckets["redirect-or-delete"]) {
  console.log(`  - ${a.slug}  [${a.pillar}]  (${a.reason})`);
}

console.log(`\n── KEEP-OR-REVISE (${buckets["keep-or-revise"].length}) ──`);
for (const a of buckets["keep-or-revise"].slice(0, 10)) {
  console.log(`  - ${a.slug}  [${a.pillar}]  (${a.reason})`);
}
if (buckets["keep-or-revise"].length > 10) {
  console.log(`  … and ${buckets["keep-or-revise"].length - 10} more`);
}

// Cost projection
const rewriteCount = buckets.rewrite.length + buckets["keep-or-revise"].length;
const enUsCost = rewriteCount * 0.12; // gpt-4o Pass 1 + Claude Sonnet Pass 2
const allLocalesCost = rewriteCount * 6 * 0.12; // 6 locales

console.log(`\n── COST PROJECTION ──`);
console.log(`  ${rewriteCount} articles × $0.12 (en-US only):  $${enUsCost.toFixed(2)}`);
console.log(`  ${rewriteCount} articles × 6 locales × $0.12:    $${allLocalesCost.toFixed(2)}`);
console.log(`  + brief refresh (~$0.05/each):                   $${(rewriteCount * 0.05).toFixed(2)}`);
console.log(`  + revisions for fine-tuning (~10% × $0.07):      $${(rewriteCount * 0.1 * 0.07).toFixed(2)}`);
console.log(`  TOTAL ESTIMATE (all locales):                    $${(allLocalesCost + rewriteCount * 0.05 + rewriteCount * 0.1 * 0.07).toFixed(2)}`);

console.log(`\nNext step:`);
console.log(`  1. Approve this plan.`);
console.log(`  2. Run scripts/refresh-briefs-for-rewrite.mjs (Phase 3) — generates new operationally-anchored briefs.`);
console.log(`  3. Run autopilot bulk regen (Phase 4).`);
console.log(`  4. Editorial review.`);
