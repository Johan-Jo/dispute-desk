/**
 * Bank-claim plan F5: `needs_review` follows the CURRENT rule mode.
 *
 * The dispute-effects dispatcher used to set `needs_review = true` when the
 * rule mode resolved to review and never clear it when the mode resolved to
 * auto, so a shop that moved to auto-pilot kept a stale flag. The deadline
 * cron reads `normalized_status`, which `needs_review` drives, and skips
 * `needs_review` disputes — so they were never filed.
 *
 * Dry run by default: lists every open, unsaved dispute with
 * `needs_review = true` and the mode its rules resolve to NOW (the same
 * `evaluateRules` inputs the dispatcher uses). `--apply` clears the flag on
 * those that resolve to auto and recomputes `normalized_status`.
 *
 *   npx tsx scripts/reconcile-needs-review.mts --env-file .env.production.local [--shop <uuid>] [--apply]
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
const { evaluateRules } = await import("../lib/rules/evaluateRules");
const { normalizeMode } = await import("../lib/rules/normalizeMode");
const { updateNormalizedStatus } = await import("../lib/disputeEvents/updateNormalizedStatus");

const sb = getServiceClient();
let q = sb
  .from("disputes")
  .select("id, shop_id, order_name, reason, status, amount, phase, due_at, normalized_status, review_state, attention_reason, dispute_gid")
  .eq("needs_review", true)
  .is("closed_at", null)
  .is("evidence_saved_to_shopify_at", null)
  .gt("due_at", new Date().toISOString())
  .order("due_at", { ascending: true })
  .range(0, 999);
if (shopId) q = q.eq("shop_id", shopId);
const { data: rows, error } = await q;
if (error) throw error;

const counts = { auto: 0, review: 0, cleared: 0 };
for (const d of rows ?? []) {
  if (String(d.dispute_gid).includes("seed")) continue;
  const res = await evaluateRules({
    id: d.id,
    shop_id: d.shop_id,
    reason: d.reason,
    status: d.status,
    amount: d.amount,
    phase: d.phase,
  });
  const mode = normalizeMode(res.action.mode);
  counts[mode] += 1;
  console.log(
    [d.order_name, d.id, d.reason, `due ${String(d.due_at).slice(0, 10)}`, `ns=${d.normalized_status}`, `review_state=${d.review_state ?? "-"}`, `mode=${mode}`].join("  "),
  );
  if (apply && mode === "auto") {
    const { error: upErr } = await sb
      .from("disputes")
      .update({ needs_review: false, updated_at: new Date().toISOString() })
      .eq("id", d.id)
      .eq("needs_review", true);
    if (upErr) {
      console.error("  update failed:", upErr.message);
      continue;
    }
    await updateNormalizedStatus(d.id);
    counts.cleared += 1;
  }
}
console.log(JSON.stringify({ scanned: rows?.length ?? 0, ...counts, applied: apply }));
