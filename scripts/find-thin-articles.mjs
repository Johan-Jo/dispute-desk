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

// Match the 10 articles from the user's punch list by title keyword.
const TARGETS = [
  { id: 1, label: "Chargeback Monitoring Programs", q: "%monitoring%" },
  { id: 2, label: "Chargeback Software Pricing", q: "%pricing%" },
  { id: 3, label: "Chargeback Automation", q: "%automation%" },
  { id: 4, label: "Automated Evidence Packs", q: "%automated%evidence%" },
  { id: 5, label: "Shopify Refund Policies", q: "%refund polic%" },
  { id: 6, label: "Reducing Chargebacks on Shopify (playbook)", q: "%reducing chargeback%" },
  { id: 7, label: "Shopify Dispute Prevention", q: "%dispute prevention%" },
  { id: 8, label: "Visa Compelling Evidence 3.0", q: "%compelling evidence%" },
  { id: 9, label: "Reduce Friendly Fraud", q: "%friendly fraud%" },
  { id: 10, label: "Login Logs as Chargeback Evidence", q: "%login%" },
];

function htmlToText(html) {
  return (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function wc(html) {
  return htmlToText(html).split(/\s+/).filter(Boolean).length;
}

for (const t of TARGETS) {
  const { data } = await sb
    .from("content_localizations")
    .select("id, content_item_id, slug, title, body_json, content_items!inner(content_type, is_hub_article, primary_pillar, workflow_status)")
    .eq("locale", "en-US")
    .eq("content_items.workflow_status", "published")
    .ilike("title", t.q);

  console.log(`\n#${t.id} ${t.label}`);
  for (const r of data ?? []) {
    const item = Array.isArray(r.content_items) ? r.content_items[0] : r.content_items;
    const words = wc(r.body_json?.mainHtml ?? "");
    console.log(`  ${r.content_item_id}`);
    console.log(`    slug: ${r.slug}`);
    console.log(`    title: ${r.title}`);
    console.log(`    type: ${item?.content_type} | hub: ${item?.is_hub_article} | pillar: ${item?.primary_pillar}`);
    console.log(`    words: ${words}`);
  }
  if (!data || data.length === 0) console.log(`  (no match for ${t.q})`);
}
