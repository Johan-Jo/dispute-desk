/**
 * Pillar 3 keeps failing in regen because the topic "Shopify fraud-coded
 * chargebacks" is a strong didactic attractor in training data — the model
 * defaults to "Types of fraud" / "Understanding fraud" / "Categories of
 * fraud" structures. Schema-leakage prevention catches each pattern but
 * the model just picks the next one.
 *
 * Fix: anchor the topic to a SPECIFIC operational claim the article must
 * defend. That removes the explainer affordance — the topic is no longer
 * "explain fraud chargebacks" but "explain why this specific scenario
 * loses".
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

const { error } = await sb
  .from("content_archive_items")
  .update({
    proposed_title: "Why fraud chargebacks lose on Shopify even with AVS Y and tracking",
    summary:
      "Operational analysis of fraud-coded chargebacks (10.4 / unauthorized) merchants lose despite clean-looking evidence. Why issuers focus on delivery quality over authorization. Where Shopify Protect coverage actually matters. The friendly-vs-true fraud distinction that changes evidence strategy.",
    status: "brief_ready",
    created_from_archive_to_content_item_id: null,
    updated_at: new Date().toISOString(),
  })
  .eq("proposed_slug", "shopify-fraud-chargebacks-explained");
if (error) {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
}
console.log("  ✓ Pillar 3 reanchored to: 'Why fraud chargebacks lose on Shopify even with AVS Y and tracking'");
