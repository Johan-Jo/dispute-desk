/**
 * Re-ingest orders whose `payment_method` is still NULL, so the
 * PaymentDetails-union fix (2026-08-30) can populate them.
 *
 * WHY THIS IS NEEDED
 * Three order queries used to spread only two of the four
 * `PaymentDetails` union members. An unmatched member comes back as a
 * bare `{__typename}` — no GraphQL error — so `pickPaymentMethod` fell
 * through to null and the order persisted with no method and, for card
 * orders, no AVS/CVV/BIN/brand either. The collection path is fixed;
 * rows written BEFORE the fix are still stale. This backfills them.
 *
 * WHAT IT DOES NOT DO
 * It does not write order columns itself. It enqueues the existing
 * `reconcile_missing_order` job per order, which routes through
 * `normalizeOrderIngest` — the same fetch + normalize + hash-gated
 * persist as the webhook path. Re-running is safe: unchanged orders
 * land as `skipped_unchanged`. One code path, no second writer to
 * drift out of sync.
 *
 * SCOPE NOTE — read before assuming a null is a bug:
 * A null `payment_method` is not automatically recoverable. Observed on
 * 6a8848-dd (2026-08-31), of 207 nulls:
 *   - 67  gateway=shopify_payments — genuinely stale, recoverable.
 *   - 137 gateway=NULL             — no gateway recorded at all; there
 *                                    is nothing to recover from.
 *   - 3   gateway=manual           — a manual order legitimately has no
 *                                    card method.
 * Only the first group is worth re-ingesting, which is why
 * `--gateway` defaults to `shopify_payments`.
 *
 * Likewise, an EMPTY card-signal row on a PayPal order is correct, not
 * missing data: `PaypalWalletPaymentDetails` carries only
 * `paymentMethodName` — no AVS, CVV, BIN or brand exists to recover.
 * Verified against the live Admin API.
 *
 * Usage:
 *   # canary first — always
 *   npx tsx scripts/shopify/reingest-payment-method.ts <shop_domain> --limit 3
 *   # then the rest
 *   npx tsx scripts/shopify/reingest-payment-method.ts <shop_domain> --limit 500 --apply
 *
 * Flags:
 *   --limit N      max orders to enqueue (default 3 — canary by default)
 *   --apply        actually enqueue; without it this is a dry run
 *   --gateway G    payment_gateway filter (default "shopify_payments";
 *                  pass "any" to drop the filter)
 *   --priority N   job priority (default 500 — BELOW interactive work,
 *                  so a bulk backfill never starves a merchant's live
 *                  pack build; see the job-priority starvation incident)
 *
 * THROUGHPUT — plan for this before queueing thousands:
 * `claim_jobs` enforces a max-1-CONCURRENT-job-per-shop invariant, and
 * the worker cron ticks every 2 minutes. For a single shop that is a
 * hard ceiling of ~30 orders/hour regardless of the worker's batch size
 * of 10 — the batch only helps when the queue spans multiple shops.
 * Measured on 6a8848-dd (2026-08-31): exactly 1 job per tick.
 *
 * So: 67 orders ≈ 2 h. surasvenne's 4,236 ≈ 6 days, blume-box's 2,692
 * ≈ 4 days. Those are background-safe (priority 500 yields to live
 * work) but they are NOT a "run it and wait" operation — queue them
 * deliberately, or raise the per-shop concurrency first.
 */
import { config } from "dotenv";
config({ path: ".env.production.local" });

const PAGE = 1000;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const shopDomain = process.argv[2];
  if (!shopDomain || shopDomain.startsWith("--")) {
    throw new Error(
      "usage: reingest-payment-method.ts <shop_domain> [--limit N] [--apply] [--gateway G] [--priority N]",
    );
  }
  const limit = Number(arg("limit", "3"));
  const apply = process.argv.includes("--apply");
  const gateway = arg("gateway", "shopify_payments")!;
  const priority = Number(arg("priority", "500"));

  const { getServiceClient } = await import("@/lib/supabase/server");
  const { enqueueJob } = await import("@/lib/jobs/claimJobs");
  const sb = getServiceClient();

  const { data: shop } = await sb
    .from("shops")
    .select("id, shop_domain")
    .eq("shop_domain", shopDomain)
    .single();
  if (!shop) throw new Error(`shop not found: ${shopDomain}`);

  // Paginate: PostgREST silently caps un-ranged selects at 1000 rows,
  // which would quietly under-report the backlog on a large shop.
  const gids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb
      .from("shopify_orders")
      .select("shopify_order_id")
      .eq("shop_id", shop.id)
      .is("payment_method", null)
      .order("processed_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (gateway !== "any") q = q.eq("payment_gateway", gateway);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    gids.push(...(data ?? []).map((r) => r.shopify_order_id as string));
    if (!data || data.length < PAGE) break;
  }

  const target = gids.slice(0, limit);
  console.log(`shop        : ${shop.shop_domain}`);
  console.log(`gateway     : ${gateway}`);
  console.log(`null method : ${gids.length} order(s) match`);
  console.log(`enqueueing  : ${target.length} (limit ${limit}, priority ${priority})`);
  console.log(`mode        : ${apply ? "APPLY" : "DRY RUN (pass --apply)"}`);

  if (!apply) {
    for (const g of target.slice(0, 10)) console.log(`  would enqueue ${g}`);
    if (target.length > 10) console.log(`  … and ${target.length - 10} more`);
    return;
  }

  let queued = 0;
  let duplicate = 0;
  for (const gid of target) {
    try {
      await enqueueJob({
        shopId: shop.id,
        jobType: "reconcile_missing_order",
        entityId: gid,
        priority,
        // Idempotent across re-runs: a second attempt for the same order
        // collides on jobs_dedupe_key_uniq (23505) instead of double-queueing.
        dedupeKey: `reingest-pm:${shop.id}:${gid}`,
      });
      queued += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("23505") || /duplicate key/i.test(msg)) {
        duplicate += 1;
        continue;
      }
      throw err;
    }
  }
  console.log(`\nqueued=${queued} alreadyQueued=${duplicate}`);
  console.log("The jobs worker runs every 2 minutes. Re-check with:");
  console.log(
    `  select count(*) filter (where payment_method is null) from shopify_orders where shop_id='${shop.id}';`,
  );
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
