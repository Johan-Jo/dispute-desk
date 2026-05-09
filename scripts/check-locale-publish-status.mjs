/**
 * Check is_published status across all locales for hub articles.
 * If the rewrite script updated body_json but didn't touch is_published,
 * translation rows may still be unpublished.
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

const { data, error } = await sb
  .from("content_localizations")
  .select("locale, is_published, content_items!inner(workflow_status, primary_pillar)")
  .eq("content_items.workflow_status", "published")
  .in("content_items.primary_pillar", [
    "chargebacks", "evidence", "fraud", "dispute-resolution",
    "mediation-arbitration", "dispute-management-software",
  ]);

if (error) { console.error(error.message); process.exit(1); }

const buckets = {};
for (const row of data ?? []) {
  const key = `${row.locale}_${row.is_published ? "published" : "unpublished"}`;
  buckets[key] = (buckets[key] ?? 0) + 1;
}

console.log("Localizations on published hub items, by locale × is_published:\n");
for (const locale of ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"]) {
  const pub = buckets[`${locale}_published`] ?? 0;
  const unpub = buckets[`${locale}_unpublished`] ?? 0;
  console.log(`  ${locale}: ${pub} published, ${unpub} unpublished`);
}
