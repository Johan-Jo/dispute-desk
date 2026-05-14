import { getServiceClient } from "./lib/supabase.mjs";
const sb = getServiceClient();

const shopId = "e5da0042-a3d4-48f4-88f3-33632a0e12d3";
const packId = "eb7c527a-ac49-4fb4-bccd-51a408c285ba";
const prefix = `${shopId}/${packId}`;

const { data, error } = await sb.storage.from("evidence-packs").list(prefix, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
console.log(`storage list ${prefix}:`);
if (error) console.error(error);
for (const f of data || []) {
  console.log(`  ${f.created_at}  ${f.name}  ${f.metadata?.size ?? "?"} bytes  mime=${f.metadata?.mimetype ?? "?"}`);
}
