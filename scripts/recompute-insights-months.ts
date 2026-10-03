/**
 * Recompute (or restore) Insights month rows for one shop or all shops.
 *
 *   node --env-file=.env.production.local --import tsx scripts/recompute-insights-months.ts \
 *     --expect-ref aokhplydttxtebvbeuzc --shop blume-box.myshopify.com \
 *     --reason metrics_v2 [--from 2025-10] [--to 2026-09] [--dry-run]
 *
 *   ... --shop <domain> --month 2026-09 --restore-revision 0 --reason rollback
 *
 * `--all` instead of `--shop` walks every installed, import-complete shop.
 * Refuses unless the env file's Supabase URL contains --expect-ref.
 * Writes only through persistShopMonth / restoreRevision (the single writer).
 * Default range: the shop's trend window (≤ 12 closed months).
 */

import { getServiceClient } from "@/lib/supabase/server";
import { computeShopMonth } from "@/lib/insights/period/computeShopMonth";
import { persistShopMonth, restoreRevision } from "@/lib/insights/period/persistShopMonth";
import { trendWindow } from "@/lib/insights/period/months";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const expectRef = arg("expect-ref");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  if (!expectRef || !url.includes(expectRef)) {
    console.error(`refusing: --expect-ref ${expectRef ?? "(missing)"} does not match ${url || "(no Supabase URL)"}`);
    process.exit(1);
  }
  const reason = arg("reason");
  if (!reason) {
    console.error("--reason is required");
    process.exit(1);
  }
  const dryRun = flag("dry-run");
  const sb = getServiceClient();
  const now = new Date();

  let q = sb
    .from("shops")
    .select("id, shop_domain, historical_import_status, historical_import_completed_at, historical_import_since_date")
    .is("uninstalled_at", null);
  if (flag("all")) q = q.eq("historical_import_status", "complete");
  else q = q.eq("shop_domain", arg("shop") ?? "__none__");
  const { data: shops, error } = await q;
  if (error) throw error;
  if (!shops?.length) {
    console.error("no matching shop");
    process.exit(1);
  }

  for (const shop of shops) {
    const restore = arg("restore-revision");
    if (restore !== undefined) {
      const month = `${arg("month")}-01`;
      if (dryRun) {
        console.log(`${shop.shop_domain} ${month}: would restore revision ${restore}`);
        continue;
      }
      const r = await restoreRevision(sb, { shopId: shop.id, month, revision: Number(restore), reason });
      console.log(`${shop.shop_domain} ${month}: restored rev ${restore} as rev ${r.revision}`);
      continue;
    }

    const { data: first } = await sb
      .from("shopify_orders")
      .select("created_at_shopify")
      .eq("shop_id", shop.id)
      .order("created_at_shopify", { ascending: true })
      .limit(1)
      .maybeSingle();
    let months = trendWindow({
      now,
      sinceDate: shop.historical_import_since_date,
      firstOrderAt: (first?.created_at_shopify as string | null) ?? null,
    });
    const from = arg("from");
    const to = arg("to");
    if (from) months = months.filter((m) => m >= `${from}-01`);
    if (to) months = months.filter((m) => m <= `${to}-01`);

    for (const month of months) {
      const { data: row } = await sb
        .from("ratio_snapshots")
        .select("revision, card_dispute_ratio, card_chargeback_count, settled_count, stable_at")
        .eq("shop_id", shop.id)
        .eq("period_month", month)
        .maybeSingle();
      const data = await computeShopMonth(sb, shop.id, month);
      const block = data.programme;
      const before = row
        ? `rev ${row.revision} ratio ${row.card_dispute_ratio ?? "—"} cb ${row.card_chargeback_count ?? "—"} settled ${row.settled_count}${row.stable_at ? " final" : ""}`
        : "no row";
      const after = `ratio ${block.cardDisputeRatio ?? "—"} cb ${block.cardChargebackCount} settled ${block.cardSettledCount} visa ${block.visaChargebackCount} mc ${block.mcChargebackCount} framing ${block.cardFramingApplies}`;
      if (dryRun) {
        console.log(`${shop.shop_domain} ${month}: ${before}  →  ${after}`);
        continue;
      }
      const r = await persistShopMonth(sb, { shopId: shop.id, shop, month, data, reason, now });
      console.log(
        `${shop.shop_domain} ${month}: ${before}  →  ${after}  [${r.changed ? `rev ${r.revision}` : "unchanged"}${r.stableAt ? ", final" : ""}]`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
