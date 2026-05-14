/**
 * One-shot: read recent file_evidence_planned audit events for the test
 * dispute (so we can see what the new errorMessage/errorCode captured),
 * then reset uploads + checklist for a fresh test run.
 *
 * Usage:
 *   node scripts/reset-file-evidence-test.mjs <disputeId>
 *
 * Resets:
 *   - deletes evidence_items where source = 'manual_upload'
 *   - clears pack.attachmentUploads
 *   - flips pack.checklist_v2 available→missing for fields no longer
 *     backed by data (since reconcile is one-way)
 */
import { getServiceClient } from "./lib/supabase.mjs";

const disputeId = process.argv[2] || "75d2ee2b-6fd3-4a33-b11b-218ff5812602";

const sb = getServiceClient();

async function main() {
  console.log(`\n=== Dispute ${disputeId} ===\n`);

  // 1. Audit events — most recent file_evidence_planned with errors
  console.log("--- Recent file_evidence_planned audit events ---");
  const { data: events, error: evErr } = await sb
    .from("audit_events")
    .select("id, created_at, event_payload")
    .eq("dispute_id", disputeId)
    .eq("event_type", "file_evidence_planned")
    .order("created_at", { ascending: false })
    .limit(5);
  if (evErr) {
    console.error("audit_events query failed:", evErr.message);
  } else if (!events || events.length === 0) {
    console.log("(no file_evidence_planned events for this dispute)");
  } else {
    for (const ev of events) {
      console.log(`\n[${ev.created_at}]`);
      const p = ev.event_payload || {};
      console.log(`  outcome=${p.outcome ?? "?"}  flagEnabled=${p.flagEnabled ?? "?"}`);
      if (Array.isArray(p.entries)) {
        for (const e of p.entries) {
          const status = e.uploaded === true
            ? "UPLOADED"
            : e.error
              ? `FAILED(${e.errorCode ?? "?"})`
              : "PENDING";
          console.log(`    ${status}  field=${e.evidenceFieldKey ?? "?"}  type=${e.attachmentType ?? "?"}`);
          if (e.errorMessage) {
            console.log(`      errorMessage: ${String(e.errorMessage).slice(0, 400)}`);
          }
          if (e.error && !e.errorMessage) {
            console.log(`      error (legacy): ${String(e.error).slice(0, 400)}`);
          }
        }
      } else {
        console.log("  (no entries array — old payload shape?)");
        console.log("  payload:", JSON.stringify(p).slice(0, 600));
      }
    }
  }

  // 2. Pack snapshot — current file evidence state
  console.log("\n--- Pack snapshot ---");
  const { data: pack, error: pkErr } = await sb
    .from("evidence_packs")
    .select("id, dispute_id, pack_json")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pkErr || !pack) {
    console.error("pack query failed:", pkErr?.message ?? "no pack");
    return;
  }
  const pj = pack.pack_json || {};
  const ups = pj.attachmentUploads ?? null;
  console.log(`pack id: ${pack.id}`);
  console.log(`attachmentUploads: ${ups ? JSON.stringify(ups, null, 2) : "(none)"}`);
  const cl = pj.checklist_v2;
  if (cl && Array.isArray(cl.items)) {
    const available = cl.items.filter((i) => i.status === "available").map((i) => i.field);
    const missing = cl.items.filter((i) => i.status === "missing").map((i) => i.field);
    console.log(`checklist available: ${available.length ? available.join(", ") : "(none)"}`);
    console.log(`checklist missing:   ${missing.length ? missing.join(", ") : "(none)"}`);
  }

  // 3. Manual uploads currently attached
  console.log("\n--- Manual uploads (evidence_items) ---");
  const { data: items } = await sb
    .from("evidence_items")
    .select("id, source, payload")
    .eq("pack_id", pack.id)
    .eq("source", "manual_upload");
  if (!items || items.length === 0) {
    console.log("(none)");
  } else {
    for (const it of items) {
      const p = it.payload || {};
      console.log(`  ${it.id}  field=${p.checklistField ?? "?"}  fileName=${p.fileName ?? "?"}`);
    }
  }

  // 4. Reset
  console.log("\n--- Resetting ---");

  // 4a. Delete manual_upload items
  const { error: delErr, count: delCount } = await sb
    .from("evidence_items")
    .delete({ count: "exact" })
    .eq("pack_id", pack.id)
    .eq("source", "manual_upload");
  if (delErr) {
    console.error("delete failed:", delErr.message);
  } else {
    console.log(`deleted ${delCount ?? "?"} manual_upload evidence_items`);
  }

  // 4b. Clear attachmentUploads + flip checklist available→missing for
  // fields no longer backed by any evidence_item.
  const { data: remainingItems } = await sb
    .from("evidence_items")
    .select("source, payload")
    .eq("pack_id", pack.id);
  const stillProvided = new Set();
  for (const it of remainingItems || []) {
    const p = it.payload || {};
    if (Array.isArray(p.fieldsProvided)) {
      for (const f of p.fieldsProvided) stillProvided.add(f);
    }
    if (typeof p.checklistField === "string") {
      stillProvided.add(p.checklistField);
    }
  }

  const newPackJson = { ...(pj || {}) };
  delete newPackJson.attachmentUploads;
  if (newPackJson.checklist_v2 && Array.isArray(newPackJson.checklist_v2.items)) {
    newPackJson.checklist_v2 = {
      ...newPackJson.checklist_v2,
      items: newPackJson.checklist_v2.items.map((i) =>
        i.status === "available" && !stillProvided.has(i.field)
          ? { ...i, status: "missing" }
          : i,
      ),
    };
  }

  const { error: upErr } = await sb
    .from("evidence_packs")
    .update({ pack_json: newPackJson })
    .eq("id", pack.id);
  if (upErr) {
    console.error("pack update failed:", upErr.message);
  } else {
    console.log("cleared attachmentUploads; flipped orphaned available→missing");
  }

  console.log("\nDone. Re-upload from the embedded UI to test.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
