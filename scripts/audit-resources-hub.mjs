#!/usr/bin/env node
/**
 * Resource Hub audit — READ-ONLY.
 *
 * Inventories every published article in the resource hub, runs a
 * battery of quality detectors, and writes a markdown report to
 * `docs/resources-hub-audit-YYYY-MM-DD.md`.
 *
 * No writes to the database. No deletions. No state mutation. Pure
 * diagnostic. The maintainer reviews the report and decides which
 * actions to take in PR 5 (the migration rewrite queue).
 *
 * Detectors:
 *   - Duplicate exact titles (case-insensitive)
 *   - Duplicate slugs per (locale, route_kind)
 *   - Near-duplicate titles (word Jaccard ≥ 0.5 inside same pillar)
 *   - Thin articles: < 700 words in body_json.mainHtml
 *   - Tier-minimum violations (inferred from page_role / content_type)
 *   - Hype-formula titles (Mastering / Navigating / Understanding / …)
 *   - Generic openings (first 400 chars of mainHtml)
 *   - Missing Shopify-specificity (chargebacks / dispute-resolution pillars)
 *   - Missing evidence-specificity (evidence-related topics)
 *   - Sitemap entries pointing at thin pages
 *   - Articles with overlapping search intent (same primary_pillar +
 *     same target_keyword OR Jaccard-overlapping titles)
 *
 * Usage:
 *   node scripts/audit-resources-hub.mjs
 *
 * Env required (loaded from .env.local automatically):
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit code: 0 always (read-only diagnostic). Non-zero only on
 * fatal errors (DB unreachable, missing creds).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

const SB_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SB_URL || !SB_KEY) {
  console.error(
    "ERROR: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and " +
      "SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.",
  );
  process.exit(1);
}

const sb = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ── Detector configuration ─────────────────────────────────────── */

/** Inferred tier minimums (PR 2 will replace this with a real tier system). */
const TIER_MINIMUMS = {
  pillar: 3500, // Tier A target
  pillar_page: 3500,
  case_study: 1800,
  support: 1000,
  checklist: 1000,
  template: 1000,
  faq: 1000,
  default: 1000, // Tier C default
};

/** Hype / SEO-formula title patterns the new prompt will ban. */
const HYPE_TITLE_PATTERNS = [
  /^mastering\b/i,
  /^navigating\b/i,
  /^understanding\b/i,
  /^complete guide to\b/i,
  /^the ultimate guide\b/i,
  /^effective strategies for\b/i,
  /^a comprehensive guide\b/i,
  /\btactical approaches\b/i,
  /\bdefinitive guide\b/i,
];

/** Generic AI-opening patterns banned from the lede. */
const GENERIC_OPENING_PATTERNS = [
  /in today'?s (digital|fast-paced|ecommerce)/i,
  /chargebacks are a (growing|major|significant) (problem|issue|challenge)/i,
  /managing (disputes|chargebacks) can be (challenging|complex|difficult)/i,
  /navigating the complexities of/i,
  /in the (fast-paced|ever-changing) world of/i,
  /businesses of all sizes/i,
];

/** Required Shopify-specific terms for chargebacks / dispute-resolution articles. */
const SHOPIFY_SPECIFICITY_TERMS = [
  "shopify",
  "shopify admin",
  "dispute_evidence",
  "chargeback response",
  "shopify payments",
];

/** Required evidence-specific terms when topic involves evidence. */
const EVIDENCE_SPECIFICITY_TERMS = [
  "AVS",
  "CVV",
  "tracking",
  "delivery",
  "evidence pack",
  "representment",
  "compelling evidence",
  "signature",
];

/* ── Helpers ────────────────────────────────────────────────────── */

function htmlToText(html) {
  if (!html || typeof html !== "string") return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Word-level Jaccard. Stopword-stripped, lowered. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "for", "in", "on", "at",
  "to", "with", "by", "as", "is", "it", "be", "this", "that", "these",
  "those", "i", "you", "your", "we", "our", "they", "their", "guide",
  "merchant", "merchants", "complete", "ultimate", "comprehensive",
]);

function tokenize(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9äöüéèáíóúãõçåæøœß\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function jaccard(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function inferTierMinimum(item, localization) {
  const role = (item.content_type ?? "").toLowerCase();
  if (item.is_hub_article === true) return TIER_MINIMUMS.pillar;
  return TIER_MINIMUMS[role] ?? TIER_MINIMUMS.default;
}

function isEvidenceTopic(item, localization) {
  const haystack = (
    (item.target_keyword ?? "") +
    " " +
    (localization.title ?? "") +
    " " +
    (localization.slug ?? "")
  ).toLowerCase();
  return /evidence|tracking|delivery|representment|avs|cvv|signature/i.test(
    haystack,
  );
}

function isShopifyTopic(item) {
  const pillar = (item.primary_pillar ?? "").toLowerCase();
  return pillar === "chargebacks" || pillar === "dispute-resolution";
}

/* ── Data load ──────────────────────────────────────────────────── */

async function loadCorpus() {
  const { data: items, error: e1 } = await sb
    .from("content_items")
    .select(
      "id, content_type, primary_pillar, target_keyword, is_hub_article, workflow_status, search_intent",
    )
    .eq("workflow_status", "published");
  if (e1) throw new Error(`Load content_items failed: ${e1.message}`);

  const ids = (items ?? []).map((i) => i.id);
  if (ids.length === 0) return [];

  const { data: locs, error: e2 } = await sb
    .from("content_localizations")
    .select("content_item_id, locale, title, slug, body_json, route_kind, is_published")
    .in("content_item_id", ids)
    .eq("is_published", true);
  if (e2) throw new Error(`Load content_localizations failed: ${e2.message}`);

  const byItem = new Map();
  for (const l of locs ?? []) {
    if (!byItem.has(l.content_item_id)) byItem.set(l.content_item_id, []);
    byItem.get(l.content_item_id).push(l);
  }

  const corpus = [];
  for (const item of items ?? []) {
    const itemLocs = byItem.get(item.id) ?? [];
    const enUS = itemLocs.find((l) => l.locale === "en-US");
    if (!enUS) continue; // Skip items without English (audit is en-first per the plan)

    const body = enUS.body_json ?? {};
    const mainHtml = typeof body.mainHtml === "string" ? body.mainHtml : "";
    const text = htmlToText(mainHtml);
    const faqText = (body.faq ?? [])
      .map((f) => `${f.q ?? ""} ${f.a ?? ""}`)
      .join(" ");
    const takeawaysText = (body.keyTakeaways ?? [])
      .map((t) => (typeof t === "string" ? t : t?.text ?? ""))
      .join(" ");
    const totalWords = wordCount(text + " " + faqText + " " + takeawaysText);
    const lede = text.slice(0, 400);

    corpus.push({
      item,
      localization: enUS,
      mainHtml,
      mainText: text,
      lede,
      totalWords,
      mainWords: wordCount(text),
      tierMinimum: inferTierMinimum(item, enUS),
      isEvidence: isEvidenceTopic(item, enUS),
      isShopify: isShopifyTopic(item),
      allLocales: itemLocs.map((l) => ({
        locale: l.locale,
        slug: l.slug,
        title: l.title,
      })),
    });
  }

  return corpus;
}

/* ── Detectors ──────────────────────────────────────────────────── */

function detectDuplicateTitles(corpus) {
  const byTitle = new Map();
  for (const row of corpus) {
    const key = row.localization.title.trim().toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(row);
  }
  return [...byTitle.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([title, rows]) => ({ title, count: rows.length, rows }));
}

function detectDuplicateSlugs(corpus) {
  const bySlug = new Map();
  for (const row of corpus) {
    const key = `${row.localization.locale}::${row.localization.route_kind}::${row.localization.slug}`;
    if (!bySlug.has(key)) bySlug.set(key, []);
    bySlug.get(key).push(row);
  }
  return [...bySlug.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([slug, rows]) => ({ slug, count: rows.length, rows }));
}

function detectNearDuplicateTitles(corpus, threshold = 0.5) {
  const pairs = [];
  // Compare within same pillar only — cross-pillar title overlap is usually OK.
  const byPillar = new Map();
  for (const row of corpus) {
    const p = row.item.primary_pillar ?? "(none)";
    if (!byPillar.has(p)) byPillar.set(p, []);
    byPillar.get(p).push(row);
  }
  for (const [pillar, rows] of byPillar) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        const sim = jaccard(a.localization.title, b.localization.title);
        if (sim >= threshold) {
          pairs.push({ pillar, similarity: Number(sim.toFixed(3)), a, b });
        }
      }
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity);
}

function detectThinArticles(corpus, threshold = 700) {
  return corpus
    .filter((r) => r.totalWords < threshold)
    .sort((a, b) => a.totalWords - b.totalWords);
}

function detectTierMinimumViolations(corpus) {
  return corpus
    .filter((r) => r.totalWords < r.tierMinimum)
    .sort((a, b) => a.totalWords / a.tierMinimum - b.totalWords / b.tierMinimum);
}

function detectHypeTitles(corpus) {
  return corpus.filter((r) => {
    const t = r.localization.title;
    return HYPE_TITLE_PATTERNS.some((re) => re.test(t));
  });
}

function detectGenericOpenings(corpus) {
  return corpus
    .map((r) => {
      const matched = GENERIC_OPENING_PATTERNS.find((re) => re.test(r.lede));
      return matched ? { row: r, match: matched.source } : null;
    })
    .filter(Boolean);
}

function detectMissingShopifySpecificity(corpus) {
  return corpus
    .filter((r) => r.isShopify)
    .map((r) => {
      const haystack = r.mainText.toLowerCase();
      const present = SHOPIFY_SPECIFICITY_TERMS.filter((t) =>
        haystack.includes(t.toLowerCase()),
      );
      return { row: r, presentTerms: present };
    })
    .filter((x) => x.presentTerms.length < 2);
}

function detectMissingEvidenceSpecificity(corpus) {
  return corpus
    .filter((r) => r.isEvidence)
    .map((r) => {
      const haystack = r.mainText.toLowerCase();
      const present = EVIDENCE_SPECIFICITY_TERMS.filter((t) =>
        haystack.includes(t.toLowerCase()),
      );
      return { row: r, presentTerms: present };
    })
    .filter((x) => x.presentTerms.length < 3);
}

function detectOverlappingSearchIntent(corpus) {
  // Same pillar + same target_keyword (when set), or same pillar + Jaccard ≥ 0.4.
  const groups = new Map();
  for (const row of corpus) {
    const kw = (row.item.target_keyword ?? "").trim().toLowerCase();
    if (!kw) continue;
    const key = `${row.item.primary_pillar ?? ""}::${kw}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, count: rows.length, rows }));
}

/** Action recommendation per article (prioritized). */
function recommendActions(corpus, findings) {
  const byId = new Map();
  function tag(row, action, reason) {
    const id = row.item.id;
    if (!byId.has(id)) byId.set(id, { row, actions: [] });
    byId.get(id).actions.push({ action, reason });
  }

  // Near-duplicate titles → strongest pair becomes redirect targets.
  // Heuristic: in each near-duplicate cluster, longest article is canonical;
  // others are redirect candidates.
  const seenInCluster = new Set();
  for (const pair of findings.nearDuplicateTitles) {
    const [longer, shorter] =
      pair.a.totalWords >= pair.b.totalWords ? [pair.a, pair.b] : [pair.b, pair.a];
    if (!seenInCluster.has(longer.item.id)) {
      tag(longer, "merge:keep-as-canonical", `near-duplicate to ${shorter.localization.title}`);
      seenInCluster.add(longer.item.id);
    }
    tag(shorter, "redirect", `near-duplicate of ${longer.localization.title}`);
  }

  // Tier minimum violation but otherwise OK → expand or rewrite.
  for (const row of findings.tierViolations) {
    const ratio = row.totalWords / row.tierMinimum;
    if (ratio < 0.4) tag(row, "rewrite_b_or_c", `${row.totalWords}w vs ${row.tierMinimum}w minimum (severely thin)`);
    else tag(row, "expand", `${row.totalWords}w vs ${row.tierMinimum}w minimum`);
  }

  // Hype titles → rewrite (replaces title; keeps URL via slug or redirects).
  for (const row of findings.hypeTitles) {
    tag(row, "rewrite_b_or_c", `hype-formula title pattern`);
  }

  // Pillar-pillar promotion candidates: high-traffic-keyword chargebacks/evidence
  // articles with `is_hub_article = true` should be promoted to Tier A.
  for (const row of corpus) {
    if (row.item.is_hub_article === true) {
      tag(row, "promote_a", "marked as hub article — Tier A pillar candidate");
    }
  }

  return byId;
}

/* ── Markdown report ────────────────────────────────────────────── */

function pct(n, total) {
  return total === 0 ? "0%" : `${((n / total) * 100).toFixed(1)}%`;
}

function buildReport(corpus, findings, recommendations) {
  const today = new Date().toISOString().slice(0, 10);
  const total = corpus.length;
  const lines = [];

  lines.push(`# Resource Hub Audit — ${today}`);
  lines.push("");
  lines.push("Generated by `scripts/audit-resources-hub.mjs` (read-only).");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total published en-US articles:** ${total}`);
  lines.push(`- **Below 700-word threshold:** ${findings.thin.length} (${pct(findings.thin.length, total)})`);
  lines.push(`- **Below tier minimum:** ${findings.tierViolations.length} (${pct(findings.tierViolations.length, total)})`);
  lines.push(`- **Hype-formula titles:** ${findings.hypeTitles.length}`);
  lines.push(`- **Generic-opening matches:** ${findings.genericOpenings.length}`);
  lines.push(`- **Near-duplicate title pairs:** ${findings.nearDuplicateTitles.length}`);
  lines.push(`- **Exact-duplicate titles:** ${findings.duplicateTitles.length}`);
  lines.push(`- **Duplicate slugs (locale+route):** ${findings.duplicateSlugs.length}`);
  lines.push(`- **Missing Shopify specificity (eligible articles):** ${findings.missingShopify.length}`);
  lines.push(`- **Missing evidence specificity (eligible articles):** ${findings.missingEvidence.length}`);
  lines.push(`- **Articles with overlapping search intent (same pillar + keyword):** ${findings.overlappingIntent.length} group(s)`);
  lines.push("");

  /* ── Section: Duplicate titles ────────────────────────────────── */
  if (findings.duplicateTitles.length > 0) {
    lines.push("## 🔴 Exact-duplicate titles");
    lines.push("");
    for (const dup of findings.duplicateTitles) {
      lines.push(`### "${dup.title}" (${dup.count} rows)`);
      for (const row of dup.rows) {
        lines.push(`- \`${row.localization.slug}\` — ${row.totalWords}w — pillar: ${row.item.primary_pillar} — id: ${row.item.id}`);
      }
      lines.push("");
    }
  }

  /* ── Section: Duplicate slugs ─────────────────────────────────── */
  if (findings.duplicateSlugs.length > 0) {
    lines.push("## 🔴 Duplicate slugs");
    lines.push("");
    for (const dup of findings.duplicateSlugs) {
      lines.push(`### \`${dup.slug}\` (${dup.count} rows)`);
      for (const row of dup.rows) {
        lines.push(`- "${row.localization.title}" — ${row.totalWords}w — id: ${row.item.id}`);
      }
      lines.push("");
    }
  }

  /* ── Section: Near-duplicate titles ───────────────────────────── */
  if (findings.nearDuplicateTitles.length > 0) {
    lines.push("## 🟠 Near-duplicate titles (Jaccard ≥ 0.5, same pillar)");
    lines.push("");
    lines.push("| Similarity | Pillar | A | B |");
    lines.push("|---|---|---|---|");
    for (const pair of findings.nearDuplicateTitles.slice(0, 30)) {
      lines.push(
        `| ${pair.similarity} | ${pair.pillar} | ${pair.a.localization.title} (${pair.a.totalWords}w) | ${pair.b.localization.title} (${pair.b.totalWords}w) |`,
      );
    }
    lines.push("");
  }

  /* ── Section: Thin articles ───────────────────────────────────── */
  if (findings.thin.length > 0) {
    lines.push("## 🟠 Thin articles (< 700 words including FAQ + takeaways)");
    lines.push("");
    lines.push("| Words | Pillar | Title |");
    lines.push("|---|---|---|");
    for (const row of findings.thin.slice(0, 50)) {
      lines.push(`| ${row.totalWords} | ${row.item.primary_pillar} | ${row.localization.title} |`);
    }
    lines.push("");
  }

  /* ── Section: Tier violations ─────────────────────────────────── */
  if (findings.tierViolations.length > 0) {
    lines.push("## 🟠 Below tier minimum");
    lines.push("");
    lines.push("Tier minimums inferred from `content_type` / `is_hub_article` (PR 2 will replace this with explicit tiers).");
    lines.push("");
    lines.push("| Words | Tier min | Ratio | Pillar | Title |");
    lines.push("|---|---|---|---|---|");
    for (const row of findings.tierViolations.slice(0, 50)) {
      const ratio = (row.totalWords / row.tierMinimum).toFixed(2);
      lines.push(`| ${row.totalWords} | ${row.tierMinimum} | ${ratio} | ${row.item.primary_pillar} | ${row.localization.title} |`);
    }
    lines.push("");
  }

  /* ── Section: Hype titles ─────────────────────────────────────── */
  if (findings.hypeTitles.length > 0) {
    lines.push("## 🟠 Hype-formula titles");
    lines.push("");
    lines.push("Titles starting with patterns the new prompt will ban.");
    lines.push("");
    for (const row of findings.hypeTitles) {
      lines.push(`- ${row.localization.title}  \`${row.localization.slug}\``);
    }
    lines.push("");
  }

  /* ── Section: Generic openings ────────────────────────────────── */
  if (findings.genericOpenings.length > 0) {
    lines.push("## 🟠 Generic AI-style openings");
    lines.push("");
    for (const { row, match } of findings.genericOpenings.slice(0, 30)) {
      lines.push(`- ${row.localization.title}`);
      lines.push(`  - matches: \`${match}\``);
      lines.push(`  - lede: ${JSON.stringify(row.lede.slice(0, 160))}`);
    }
    lines.push("");
  }

  /* ── Section: Missing Shopify specificity ─────────────────────── */
  if (findings.missingShopify.length > 0) {
    lines.push("## 🟡 Missing Shopify-specific terms");
    lines.push("");
    lines.push("Chargebacks / dispute-resolution articles with fewer than 2 Shopify-specific terms.");
    lines.push("");
    for (const x of findings.missingShopify.slice(0, 30)) {
      lines.push(
        `- ${x.row.localization.title} — present: ${x.presentTerms.length === 0 ? "(none)" : x.presentTerms.join(", ")}`,
      );
    }
    lines.push("");
  }

  /* ── Section: Missing evidence specificity ────────────────────── */
  if (findings.missingEvidence.length > 0) {
    lines.push("## 🟡 Missing evidence-specific terms");
    lines.push("");
    lines.push("Evidence-related articles with fewer than 3 evidence terms.");
    lines.push("");
    for (const x of findings.missingEvidence.slice(0, 30)) {
      lines.push(
        `- ${x.row.localization.title} — present: ${x.presentTerms.length === 0 ? "(none)" : x.presentTerms.join(", ")}`,
      );
    }
    lines.push("");
  }

  /* ── Section: Overlapping search intent ───────────────────────── */
  if (findings.overlappingIntent.length > 0) {
    lines.push("## 🟠 Overlapping search intent (same pillar + same target_keyword)");
    lines.push("");
    for (const group of findings.overlappingIntent) {
      lines.push(`### ${group.key}`);
      for (const row of group.rows) {
        lines.push(`- ${row.localization.title} — ${row.totalWords}w — id: ${row.item.id}`);
      }
      lines.push("");
    }
  }

  /* ── Section: Recommended actions ─────────────────────────────── */
  lines.push("## 📋 Recommended actions");
  lines.push("");
  lines.push("Each article carries one or more recommended migration actions, ordered by severity. Apply via PR 5's migration queue (admin tool).");
  lines.push("");
  lines.push("| Article | Words | Actions |");
  lines.push("|---|---|---|");
  const sorted = [...recommendations.values()].sort((a, b) => a.row.totalWords - b.row.totalWords);
  for (const { row, actions } of sorted) {
    const acts = actions
      .map((a) => `\`${a.action}\` (${a.reason})`)
      .join(" · ");
    lines.push(`| ${row.localization.title} | ${row.totalWords} | ${acts} |`);
  }
  lines.push("");

  /* ── Footer ───────────────────────────────────────────────────── */
  lines.push("---");
  lines.push("");
  lines.push("**Next step:** when PR 5 lands, the migration queue UI will let you tag each article with one of: `keep | expand | merge | redirect | noindex | rewrite_b | rewrite_c | promote_a`. The recommendations above are starting points, not commands.");
  lines.push("");

  return lines.join("\n");
}

/* ── Main ───────────────────────────────────────────────────────── */

async function main() {
  console.log("[audit] loading corpus …");
  const corpus = await loadCorpus();
  console.log(`[audit] corpus size: ${corpus.length} en-US articles`);

  console.log("[audit] running detectors …");
  const findings = {
    duplicateTitles: detectDuplicateTitles(corpus),
    duplicateSlugs: detectDuplicateSlugs(corpus),
    nearDuplicateTitles: detectNearDuplicateTitles(corpus),
    thin: detectThinArticles(corpus),
    tierViolations: detectTierMinimumViolations(corpus),
    hypeTitles: detectHypeTitles(corpus),
    genericOpenings: detectGenericOpenings(corpus),
    missingShopify: detectMissingShopifySpecificity(corpus),
    missingEvidence: detectMissingEvidenceSpecificity(corpus),
    overlappingIntent: detectOverlappingSearchIntent(corpus),
  };

  console.log(`[audit] findings:`, {
    duplicateTitles: findings.duplicateTitles.length,
    duplicateSlugs: findings.duplicateSlugs.length,
    nearDuplicateTitles: findings.nearDuplicateTitles.length,
    thin: findings.thin.length,
    tierViolations: findings.tierViolations.length,
    hypeTitles: findings.hypeTitles.length,
    genericOpenings: findings.genericOpenings.length,
    missingShopify: findings.missingShopify.length,
    missingEvidence: findings.missingEvidence.length,
    overlappingIntent: findings.overlappingIntent.length,
  });

  const recommendations = recommendActions(corpus, findings);
  const report = buildReport(corpus, findings, recommendations);

  const today = new Date().toISOString().slice(0, 10);
  const outPath = join("docs", `resources-hub-audit-${today}.md`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report, "utf8");
  console.log(`[audit] report written: ${outPath} (${report.length} chars)`);
}

main().catch((err) => {
  console.error("[audit] fatal:", err);
  process.exit(1);
});
