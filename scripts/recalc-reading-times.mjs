/**
 * Recalculate reading_time_minutes for every hub localization based on
 * current body word count. Fixes stale values left behind by bulk rewrites
 * that updated body_json but not the reading_time column.
 *
 * Reading time formula: words / 200 (200 wpm avg), min 1.
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

function htmlToText(html) {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function wc(html) {
  return htmlToText(html).split(/\s+/).filter(Boolean).length;
}
function readingTime(words) {
  return Math.max(1, Math.round(words / 200));
}

const { data, error } = await sb
  .from("content_localizations")
  .select("id, locale, body_json, reading_time_minutes, content_items!inner(workflow_status, primary_pillar)")
  .eq("content_items.workflow_status", "published");

if (error) { console.error(error.message); process.exit(1); }

console.log(`Recalculating reading time for ${data?.length ?? 0} published localizations...\n`);

let updated = 0;
let unchanged = 0;
const histogram = {};

for (const row of data ?? []) {
  const html = row.body_json?.mainHtml ?? "";
  const words = wc(html);
  const newRT = readingTime(words);
  histogram[newRT] = (histogram[newRT] ?? 0) + 1;

  if (row.reading_time_minutes === newRT) {
    unchanged++;
    continue;
  }

  const { error: updErr } = await sb
    .from("content_localizations")
    .update({ reading_time_minutes: newRT })
    .eq("id", row.id);
  if (updErr) {
    console.error(`  ✗ ${row.id}: ${updErr.message}`);
    continue;
  }
  updated++;
}

console.log(`Updated: ${updated}`);
console.log(`Unchanged: ${unchanged}`);
console.log(`\nReading time distribution after fix:`);
const sortedRTs = Object.keys(histogram).map(Number).sort((a, b) => a - b);
for (const rt of sortedRTs) {
  console.log(`  ${rt} min: ${histogram[rt]} localizations`);
}
