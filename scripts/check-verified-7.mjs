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
  "automated-evidence-packs-shopify-check",
  "crafting-shopify-refund-policies-minimize-chargebacks",
  "understanding-chargeback-software-pricing-models",
  "optimizing-chargeback-automation-tasks",
  "chargeback-monitoring-programs-ecommerce-merchants",
  "shopify-merchant-playbook-unauthorized-purchase-chargebacks",
  "mastercard-chargeback-reason-codes-shopify",
];

function wc(html) {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

console.log("Verified 7 articles — current state:\n");
for (const slug of SLUGS) {
  const { data } = await sb
    .from("content_localizations")
    .select("id, content_item_id, title, body_json, reading_time_minutes, content_items!inner(content_type, is_hub_article, primary_pillar)")
    .eq("slug", slug)
    .eq("locale", "en-US")
    .maybeSingle();
  if (!data) {
    console.log(`✗ ${slug} — NOT FOUND`);
    continue;
  }
  const item = Array.isArray(data.content_items) ? data.content_items[0] : data.content_items;
  const words = wc(data.body_json?.mainHtml ?? "");
  console.log(`${slug}`);
  console.log(`  content_item_id: ${data.content_item_id}`);
  console.log(`  type: ${item?.content_type} | pillar: ${item?.primary_pillar} | hub: ${item?.is_hub_article}`);
  console.log(`  words: ${words} | reading: ${data.reading_time_minutes}min`);
  console.log(`  title: ${data.title}\n`);
}
