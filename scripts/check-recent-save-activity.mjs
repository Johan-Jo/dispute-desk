import { getServiceClient } from "./lib/supabase.mjs";

const disputeId = process.argv[2] || "75d2ee2b-6fd3-4a33-b11b-218ff5812602";
const sb = getServiceClient();

const { data: events } = await sb
  .from("audit_events")
  .select("created_at, event_type, event_payload")
  .eq("dispute_id", disputeId)
  .gte("created_at", "2026-05-04T01:55:00Z")
  .order("created_at", { ascending: false })
  .limit(20);

console.log(`Audit events for dispute since 01:55 UTC (post-fix deploy):`);
if (!events || events.length === 0) {
  console.log("  (none)");
} else {
  for (const ev of events) {
    console.log(`  [${ev.created_at}] ${ev.event_type}`);
    const p = ev.event_payload || {};
    if (p.error || p.errorMessage) console.log(`    error: ${(p.errorMessage ?? p.error).toString().slice(0, 200)}`);
    if (p.failures) console.log(`    failures: ${p.failures}`);
    if (Array.isArray(p.attachments)) {
      for (const a of p.attachments) {
        const status = a.ok ? "OK" : `FAIL(${a.errorCode ?? "?"})`;
        console.log(`    ${status}  ${a.targetField}  ${a.errorMessage ? a.errorMessage.slice(0, 200) : ""}`);
      }
    }
  }
}
