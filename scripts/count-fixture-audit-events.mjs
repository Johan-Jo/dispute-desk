import { getServiceClient } from "./lib/supabase.mjs";

const sb = getServiceClient();

const { data: orphans } = await sb
  .from("disputes")
  .select("id")
  .like("dispute_gid", "gid://shopify/ShopifyPaymentsDispute/test-%");
const disputeIds = orphans.map(r => r.id);

const { data: packs } = await sb
  .from("evidence_packs")
  .select("id")
  .in("dispute_id", disputeIds);
const packIds = packs.map(p => p.id);

const { count: byDispute } = await sb
  .from("audit_events")
  .select("id", { count: "exact", head: true })
  .in("dispute_id", disputeIds);

const { count: byPack } = await sb
  .from("audit_events")
  .select("id", { count: "exact", head: true })
  .in("pack_id", packIds);

const { data: sample } = await sb
  .from("audit_events")
  .select("event_type, created_at")
  .in("dispute_id", disputeIds)
  .order("created_at", { ascending: false })
  .limit(8);

console.log(`Disputes: ${disputeIds.length}, Packs: ${packIds.length}`);
console.log(`audit_events with dispute_id in fixture set: ${byDispute}`);
console.log(`audit_events with pack_id   in fixture set: ${byPack}`);
console.log("\nMost recent fixture audit events:");
for (const e of sample ?? []) console.log(`  ${e.created_at}  ${e.event_type}`);
