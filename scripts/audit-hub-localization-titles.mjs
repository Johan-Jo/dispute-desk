/**
 * Audit published hub localizations: every non-English locale is checked against the
 * English (en-US) baseline for the same content_item_id — not Swedish-only.
 *
 * Locales audited (must differ from en-US when published): de-DE, fr-FR, es-ES, pt-BR, sv-SE.
 * Baseline: en-US.
 *
 * Requires: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/audit-hub-localization-titles.mjs
 *   node scripts/audit-hub-localization-titles.mjs --csv
 *   node scripts/audit-hub-localization-titles.mjs --json
 *   node scripts/audit-hub-localization-titles.mjs --fail   # exit 1 if any issue (CI / ops)
 *   node scripts/audit-hub-localization-titles.mjs --locale-coverage   # gaps: missing published locales
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { resolve } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key);

const asCsv = process.argv.includes("--csv");
const asJson = process.argv.includes("--json");
const failOnIssues = process.argv.includes("--fail");
const localeCoverage = process.argv.includes("--locale-coverage");

/** All hub locales — must match lib/resources/constants.ts HUB_CONTENT_LOCALES */
const ALL_HUB_LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];

/** Hub locale → marketing path segment (default en has no prefix). */
const HUB_TO_PATH = {
  "en-US": "en",
  "de-DE": "de",
  "fr-FR": "fr",
  "es-ES": "es",
  "pt-BR": "pt",
  "sv-SE": "sv",
};

const SIM_THRESHOLD = 0.95;

function norm(s) {
  return (s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  if (!a || !b) return a === b ? 1 : 0;
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

async function fetchAllPublishedLocalizations() {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await sb
      .from("content_localizations")
      .select(
        `id, content_item_id, locale, route_kind, title, slug, meta_title, og_title, translation_status,
         content_items!inner ( workflow_status, primary_pillar )`
      )
      .eq("is_published", true)
      .eq("content_items.workflow_status", "published")
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function flattenItem(row) {
  const item = Array.isArray(row.content_items)
    ? row.content_items[0]
    : row.content_items;
  return {
    id: row.id,
    content_item_id: row.content_item_id,
    locale: row.locale,
    route_kind: row.route_kind,
    title: row.title ?? "",
    slug: row.slug ?? "",
    meta_title: row.meta_title ?? "",
    og_title: row.og_title ?? "",
    translation_status: row.translation_status ?? "",
    primary_pillar: item?.primary_pillar ?? "",
  };
}

async function main() {
  const raw = await fetchAllPublishedLocalizations();
  const flat = raw.map(flattenItem);

  const byItem = new Map();
  for (const r of flat) {
    if (!byItem.has(r.content_item_id)) byItem.set(r.content_item_id, []);
    byItem.get(r.content_item_id).push(r);
  }

  /** @type {Array<Record<string, unknown>>} */
  const issues = [];

  for (const [, locs] of byItem) {
    const en = locs.find((l) => l.locale === "en-US");
    if (!en) continue;

    for (const loc of locs) {
      if (loc.locale === "en-US") continue;

      const rowIssues = [];
      if (norm(loc.title) && norm(loc.title) === norm(en.title)) {
        rowIssues.push("title_matches_en");
      } else if (norm(loc.title) && similarity(loc.title, en.title) >= SIM_THRESHOLD) {
        rowIssues.push("title_high_similarity_en");
      }

      if (norm(loc.meta_title) && norm(en.meta_title)) {
        if (norm(loc.meta_title) === norm(en.meta_title)) {
          rowIssues.push("meta_title_matches_en");
        } else if (similarity(loc.meta_title, en.meta_title) >= SIM_THRESHOLD) {
          rowIssues.push("meta_title_high_similarity_en");
        }
      }

      if (norm(loc.og_title) && norm(en.og_title)) {
        if (norm(loc.og_title) === norm(en.og_title)) {
          rowIssues.push("og_title_matches_en");
        } else if (similarity(loc.og_title, en.og_title) >= SIM_THRESHOLD) {
          rowIssues.push("og_title_high_similarity_en");
        }
      }

      if (rowIssues.length === 0) continue;

      if (
        loc.translation_status === "complete" &&
        rowIssues.some((x) => x === "title_matches_en" || x === "meta_title_matches_en")
      ) {
        rowIssues.push("marked_complete_but_seo_matches_en");
      }

      const pathSeg = HUB_TO_PATH[loc.locale] ?? loc.locale;
      const pathPrefix = pathSeg === "en" ? "" : `/${pathSeg}`;
      const publicPath =
        loc.route_kind === "resources"
          ? `${pathPrefix}/resources/${loc.primary_pillar}/${loc.slug}`
          : `${pathPrefix}/${loc.route_kind}/${loc.slug}`;

      issues.push({
        issues: rowIssues.join(";"),
        content_item_id: loc.content_item_id,
        localization_id: loc.id,
        route_kind: loc.route_kind,
        locale: loc.locale,
        primary_pillar: loc.primary_pillar,
        slug: loc.slug,
        en_title: en.title,
        title: loc.title,
        public_path: publicPath,
        admin_path: `/admin/resources/content/${loc.content_item_id}`,
        translation_status: loc.translation_status,
      });
    }
  }

  /** @type {Record<string, number>} */
  const byLocale = {};
  for (const loc of ALL_HUB_LOCALES) {
    if (loc === "en-US") continue;
    byLocale[loc] = 0;
  }
  for (const r of issues) {
    const loc = r.locale;
    if (byLocale[loc] !== undefined) byLocale[loc] += 1;
  }

  /** Published-locale gaps: items with en-US published but not all six locales published */
  /** @type {Array<{ content_item_id: string; missing_locales: string[]; published_locales: string[]; slug_en: string }>} */
  const localeGaps = [];
  if (localeCoverage) {
    for (const [cid, locs] of byItem) {
      const en = locs.find((l) => l.locale === "en-US");
      if (!en) continue;
      const published = new Set(locs.map((l) => l.locale));
      const missing = ALL_HUB_LOCALES.filter((l) => !published.has(l));
      if (missing.length > 0) {
        localeGaps.push({
          content_item_id: cid,
          missing_locales: missing,
          published_locales: [...published].sort(),
          slug_en: en.slug,
          pillar: en.primary_pillar,
        });
      }
    }
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          baselineLocale: "en-US",
          auditedNonEnglishLocales: ALL_HUB_LOCALES.filter((l) => l !== "en-US"),
          count: issues.length,
          byLocale,
          rows: issues,
          ...(localeCoverage ? { localeCoverageGaps: localeGaps.length, localeGaps } : {}),
        },
        null,
        2
      )
    );
  } else if (asCsv) {
    const headers = [
      "issues",
      "locale",
      "route_kind",
      "slug",
      "primary_pillar",
      "title",
      "en_title",
      "translation_status",
      "public_path",
      "admin_path",
      "content_item_id",
      "localization_id",
    ];
    console.log(headers.join(","));
    for (const r of issues) {
      const esc = (v) => {
        const s = String(v ?? "");
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      console.log(
        [
          r.issues,
          r.locale,
          r.route_kind,
          r.slug,
          r.primary_pillar,
          r.title,
          r.en_title,
          r.translation_status,
          r.public_path,
          r.admin_path,
          r.content_item_id,
          r.localization_id,
        ]
          .map(esc)
          .join(",")
      );
    }
  } else {
    console.log(
      "Baseline: en-US. Non-English locales compared to English: de-DE, fr-FR, es-ES, pt-BR, sv-SE.\n"
    );
    console.log(`Published localizations with EN copy still present: ${issues.length}\n`);
    for (const r of issues) {
      console.log(`— ${r.issues}`);
      console.log(`  ${r.locale}  ${r.route_kind}  ${r.slug}`);
      console.log(`  title: ${r.title}`);
      console.log(`  public: ${r.public_path}`);
      console.log(`  admin:  ${r.admin_path}`);
      console.log("");
    }
    console.log("Issues by locale:");
    for (const loc of ALL_HUB_LOCALES) {
      if (loc === "en-US") continue;
      console.log(`  ${loc}: ${byLocale[loc] ?? 0}`);
    }
    if (issues.length === 0) {
      console.log("\nAll non-English published rows pass title/meta/og comparison to the English baseline.");
    }
    if (localeCoverage) {
      console.log(
        `\nLocale coverage (published items with en-US but not all 6 hub locales published): ${localeGaps.length}`
      );
      for (const g of localeGaps) {
        console.log(
          `  — ${g.slug_en} [${g.pillar}] missing: ${g.missing_locales.join(", ")} → /admin/resources/content/${g.content_item_id}`
        );
      }
    }
  }

  if (failOnIssues && issues.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
