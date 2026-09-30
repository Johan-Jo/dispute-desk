/**
 * Fix A5 (docs/plans/mein-maison-status-and-no-return.plan.md): classify open
 * disputes Shopify already reports as under review, where DisputeDesk sent
 * nothing, so they leave the "pending" counts.
 *
 * Candidates: open (`closed_at` null), Shopify status `under_review` with a
 * real deadline, `submission_state = 'not_saved'`. The sync is hourly and our
 * status matched Shopify on every open dispute when this was measured, so the
 * DB status is the live one.
 *
 * Classification is bounded by the CURRENT cycle start — the latest of
 * `reopened_at`, `escalated_from_inquiry_at`, `initiated_at` — so an inquiry
 * answered before its escalation, or a response before a reopen, never marks
 * the current round as answered:
 *   - a `needs_response → under_review` status event after the cycle start
 *       → responded_via_shopify (+ a `response_sent_via_shopify` event)
 *   - none                                   → under_review_unattributed
 *
 * Also recomputes `normalized_status` for `under_review` disputes with no
 * deadline yet (Shopify's creation state, A1), which read "submitted to bank".
 *
 * Dry run by default; prints every row with its evidence.
 *
 *   npx tsx scripts/backfill-response-state.mts --env-file .env.production.local [--shop <uuid>] [--apply]
 */
import { config } from "dotenv";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const envFile = arg("env-file");
const shopId = arg("shop");
const apply = process.argv.includes("--apply");
if (!envFile) {
  console.error("usage: --env-file <f> [--shop <uuid>] [--apply]");
  process.exit(1);
}
config({ path: envFile, override: true });

const { getServiceClient } = await import("../lib/supabase/server");
const { updateNormalizedStatus } = await import("../lib/disputeEvents/updateNormalizedStatus");
const { emitDisputeEvent } = await import("../lib/disputeEvents/emitEvent");
const { RESPONSE_SENT_VIA_SHOPIFY } = await import("../lib/disputeEvents/eventTypes");
const { hasRealDeadline } = await import("../lib/disputes/responseCycle");

const sb = getServiceClient();
console.log(`target: ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL}`);

let q = sb
  .from("disputes")
  .select(
    "id, shop_id, order_name, phase, status, due_at, initiated_at, reopened_at, " +
      "escalated_from_inquiry_at, response_cycle, submission_state, normalized_status, dispute_gid",
  )
  .eq("status", "under_review")
  .is("closed_at", null)
  .order("shop_id")
  .range(0, 999);
if (shopId) q = q.eq("shop_id", shopId);
const { data, error } = await q;
if (error) throw error;
const rows = (data ?? []) as unknown as Array<Record<string, string | number | null>>;

const latest = (...ts: Array<string | number | null | undefined>) =>
  ts
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .reduce<string | null>((a, b) => (a == null || new Date(b) > new Date(a) ? b : a), null);

const perShop = new Map<string, Record<string, number>>();
const bump = (shop: string, k: string) => {
  const m = perShop.get(shop) ?? {};
  m[k] = (m[k] ?? 0) + 1;
  perShop.set(shop, m);
};

for (const d of rows) {
  const shop = String(d.shop_id);
  if (String(d.dispute_gid).includes("seed")) continue;

  // A1: creation state — no deadline yet. Only the normalized status moves.
  if (!hasRealDeadline(d.due_at as string | null)) {
    bump(shop, "creation_state");
    console.log([d.order_name, d.id, "creation state (no deadline)", `ns=${d.normalized_status}`].join("  "));
    if (apply) await updateNormalizedStatus(String(d.id));
    continue;
  }
  if (d.submission_state !== "not_saved") {
    bump(shop, `skip_${d.submission_state}`);
    continue;
  }

  const cycleStart = latest(
    d.reopened_at as string | null,
    d.escalated_from_inquiry_at as string | null,
    d.initiated_at as string | null,
  );
  const { data: evs, error: evErr } = await sb
    .from("dispute_events")
    .select("event_at, metadata_json")
    .eq("dispute_id", String(d.id))
    .eq("event_type", "status_changed")
    .order("event_at", { ascending: true });
  if (evErr) throw evErr;
  const transition = (evs ?? []).find((e) => {
    const m = (e.metadata_json ?? {}) as Record<string, unknown>;
    if (m.old_status !== "needs_response" || m.new_status !== "under_review") return false;
    return cycleStart == null || new Date(e.event_at as string) > new Date(cycleStart);
  });
  const state = transition ? "responded_via_shopify" : "under_review_unattributed";
  bump(shop, state);
  console.log(
    [
      d.order_name,
      d.id,
      d.phase,
      `due ${String(d.due_at).slice(0, 10)}`,
      `cycle ${d.response_cycle ?? 1} from ${cycleStart ? String(cycleStart).slice(0, 16) : "-"}`,
      transition ? `answered ${String(transition.event_at).slice(0, 16)}` : "no transition in cycle",
      `-> ${state}`,
    ].join("  "),
  );
  if (!apply) continue;

  const { error: upErr } = await sb
    .from("disputes")
    .update({ submission_state: state })
    .eq("id", String(d.id))
    .eq("submission_state", "not_saved");
  if (upErr) {
    console.error("  update failed:", upErr.message);
    continue;
  }
  if (transition) {
    const cycle = Number(d.response_cycle ?? 1);
    await emitDisputeEvent({
      disputeId: String(d.id),
      shopId: shop,
      eventType: RESPONSE_SENT_VIA_SHOPIFY,
      description: "A response was sent through Shopify",
      eventAt: String(transition.event_at),
      actorType: "shopify",
      sourceType: "system",
      metadataJson: { response_cycle: cycle, phase: d.phase, backfill: true },
      dedupeKey: `${d.id}:${RESPONSE_SENT_VIA_SHOPIFY}:c${cycle}`,
    });
  }
  await updateNormalizedStatus(String(d.id));
}

console.log("\nper shop:");
for (const [shop, m] of perShop) console.log(shop, JSON.stringify(m));
console.log(apply ? "APPLIED" : "dry run (pass --apply to write)");
