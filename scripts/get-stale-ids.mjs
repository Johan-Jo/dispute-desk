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

const { data: enUs } = await sb
  .from("content_localizations")
  .select("id, content_item_id, last_updated_at, content_items!inner(workflow_status)")
  .eq("locale", "en-US")
  .eq("content_items.workflow_status", "published");

const STALE = 30 * 60 * 1000;
let count = 0;
for (const e of enUs ?? []) {
  if (!e.last_updated_at) continue;
  const eTime = new Date(e.last_updated_at).getTime();
  const { data: others } = await sb
    .from("content_localizations")
    .select("id, locale, last_updated_at, slug")
    .eq("content_item_id", e.content_item_id)
    .neq("locale", "en-US");
  for (const o of others ?? []) {
    if (eTime - new Date(o.last_updated_at ?? 0).getTime() > STALE) {
      console.log(`${o.locale} ${o.id} ${o.slug}`);
      if (++count >= 5) process.exit(0);
    }
  }
}
