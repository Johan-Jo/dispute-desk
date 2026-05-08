/**
 * Temporarily restrict target_locale_set on the 3 Tier A pillars to en-US only.
 * Generating 6 locales in parallel saturates the OpenAI gpt-4o TPM bucket
 * (30K/min × 6 locales × 5–6K tokens each = blow the budget).
 * Translations come later as a single-locale-at-a-time pass.
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

const SLUGS = [
  "shopify-chargebacks-complete-merchant-guide",
  "chargeback-evidence-guide-shopify-merchants",
  "shopify-fraud-chargebacks-explained",
];

for (const slug of SLUGS) {
  const { error } = await sb
    .from("content_archive_items")
    .update({
      target_locale_set: ["en-US"],
      // Reset status in case a failed generation flipped it.
      status: "brief_ready",
      created_from_archive_to_content_item_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("proposed_slug", slug);
  if (error) {
    console.error(`${slug}: ${error.message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${slug}  → target_locale_set=['en-US'], status=brief_ready`);
}
