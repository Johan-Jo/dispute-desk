/**
 * One-off: assign backlog_rank=1,2,3 to the three Tier A pillar briefs so the
 * autopilot picker (which orders by backlog_rank ASC, NULLS LAST) picks them
 * first. Default-inserted rows have NULL backlog_rank and sort to the bottom.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { resolve } from "path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key);

const RANKED = [
  { slug: "shopify-chargebacks-complete-merchant-guide", rank: 1 },
  { slug: "chargeback-evidence-guide-shopify-merchants", rank: 2 },
  { slug: "shopify-fraud-chargebacks-explained", rank: 3 },
];

async function main() {
  for (const r of RANKED) {
    const { error, data } = await sb
      .from("content_archive_items")
      .update({ backlog_rank: r.rank, updated_at: new Date().toISOString() })
      .eq("proposed_slug", r.slug)
      .select("id, backlog_rank, proposed_slug");
    if (error) {
      console.error(`Failed for ${r.slug}: ${error.message}`);
      process.exit(1);
    }
    console.log(`  rank ${r.rank} → ${r.slug}  (${data?.[0]?.id ?? "no row"})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
