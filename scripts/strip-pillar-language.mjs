/**
 * Strip "pillar", "guide", "complete", "Tier A" language from the 3 Tier A
 * archive items' proposed_title and summary. Those words cue the model
 * toward SEO-blog/educational mode regardless of the system prompt.
 *
 * The internal CMS classification (tier_override='A', archetype='authority_pillar')
 * stays — that's code routing. Only the strings the model SEES are cleaned.
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

const UPDATES = [
  {
    slug: "shopify-chargebacks-complete-merchant-guide",
    proposed_title: "Shopify chargebacks operations",
    summary:
      "End-to-end Shopify chargeback handling from inquiry through claim through response through outcome. Admin paths, Shopify Payments behaviour, response windows, where automation does and does not help.",
  },
  {
    slug: "chargeback-evidence-guide-shopify-merchants",
    proposed_title: "Shopify chargeback evidence quality",
    summary:
      "What evidence wins Shopify chargebacks: AVS, CVV, tracking, IP, 3-D Secure, signed delivery, screenshots — what each proves and what it fails to prove, mapped to dispute reason families.",
  },
  {
    slug: "shopify-fraud-chargebacks-explained",
    proposed_title: "Shopify fraud-coded chargebacks",
    summary:
      "Fraud-coded chargebacks (10.4 / unauthorized): how Shopify surfaces them, what evidence works, when prevention beats response, and how true fraud and friendly fraud differ operationally.",
  },
];

for (const u of UPDATES) {
  const { error } = await sb
    .from("content_archive_items")
    .update({
      proposed_title: u.proposed_title,
      summary: u.summary,
      status: "brief_ready",
      created_from_archive_to_content_item_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("proposed_slug", u.slug);
  if (error) {
    console.error(`${u.slug}: ${error.message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${u.slug}`);
  console.log(`    title: ${u.proposed_title}`);
}
console.log("\nDone. proposed_slug stays unchanged so URL targets are preserved.");
