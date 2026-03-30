/**
 * Import editorial backlog rows into content_archive_items.
 *
 * Requires: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Usage:
 *   node scripts/import-content-backlog.mjs path/to/list.json           # append after max backlog_rank
 *   node scripts/import-content-backlog.mjs --clear                     # replace: clear non-converted, import default JSON
 *   node scripts/import-content-backlog.mjs path/to/list.json --clear   # replace from that file
 *
 * Without --clear, each row gets backlog_rank = max(existing backlog_rank) + 100 + i*100.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

config({ path: ".env.local" });

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const LOCALES = ["en-US", "de-DE", "fr-FR", "es-ES", "pt-BR", "sv-SE"];

const args = process.argv.slice(2);
const clearFirst = args.includes("--clear");
const fileArg = args.find((a) => !a.startsWith("--"));
const jsonPath = fileArg ? join(process.cwd(), fileArg) : join(__dirname, "backlog-import.json");

const raw = readFileSync(jsonPath, "utf8");
const items = JSON.parse(raw);
if (!Array.isArray(items) || items.length === 0) {
  console.error("Expected a non-empty JSON array");
  process.exit(1);
}

const sb = createClient(url, key);

async function main() {
  if (clearFirst) {
    const { error: delErr } = await sb.from("content_archive_items").delete().neq("status", "converted");
    if (delErr) {
      console.error("Clear failed:", delErr.message);
      process.exit(1);
    }
    console.log("Removed non-converted archive rows.");
  }

  let rankBase = 0;
  if (!clearFirst) {
    const { data: maxRow, error: rankErr } = await sb
      .from("content_archive_items")
      .select("backlog_rank")
      .order("backlog_rank", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rankErr) {
      console.error("Could not read max backlog_rank:", rankErr.message);
      process.exit(1);
    }
    const max =
      typeof maxRow?.backlog_rank === "number" && Number.isFinite(maxRow.backlog_rank)
        ? maxRow.backlog_rank
        : -100;
    rankBase = max + 100;
  }

  for (let i = 0; i < items.length; i++) {
    const row = items[i];
    const payload = {
      proposed_title: String(row.proposed_title ?? "").trim(),
      proposed_slug: null,
      target_locale_set: LOCALES,
      content_type: row.content_type,
      primary_pillar: row.primary_pillar,
      priority_score: Number(row.priority_score) || 50,
      backlog_rank: rankBase + i * 100,
      target_keyword: row.target_keyword ? String(row.target_keyword).trim() : null,
      search_intent: row.search_intent ? String(row.search_intent).trim() : "informational",
      summary: row.summary ? String(row.summary).trim() : null,
      status: row.status ?? "backlog",
    };

    if (!payload.proposed_title) {
      console.error(`Row ${i}: missing proposed_title`);
      process.exit(1);
    }

    const { error } = await sb.from("content_archive_items").insert(payload);
    if (error) {
      console.error(`Row ${i} (${payload.proposed_title.slice(0, 48)}…):`, error.message);
      process.exit(1);
    }
  }

  console.log(`Imported ${items.length} backlog row(s) from ${jsonPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
