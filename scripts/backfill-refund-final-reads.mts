// Final-read backfill for the per-store refund results (docs/plans/pending-refund-advice.plan.md section 7).
// Reads each CLOSED / ESCALATED inquiry's order from Shopify (read-only GraphQL) and, with --apply, stores the
// refund settlements in dispute_refund_state (final_read_at set). Without --apply nothing is written; it still
// reads Shopify so the figures it prints are real.
//
//   npx tsx scripts/backfill-refund-final-reads.mts --env-file .env.production.local --limit 3            # canary, dry
//   npx tsx scripts/backfill-refund-final-reads.mts --env-file .env.production.local --limit 3 --apply    # canary, write
//   npx tsx scripts/backfill-refund-final-reads.mts --env-file .env.production.local --limit 400 --apply   # batch
//
// The refund-state cron does the same 40 per run; this is for the first fill. Requires the migration
// 20261113110000 on the target database.
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ORDER_REFUND_STATE_QUERY } from "../lib/shopify/queries/orderRefundState";
import { resolveRefundState } from "../lib/disputes/refundState";
import { upsertRefundState } from "../lib/disputes/refundStateStore";
import { runFinalReads } from "../lib/disputes/refundFinalReads";
import { loadFinalReadCandidates, loadRefundOutcomeRows } from "../lib/disputes/refundOutcomeData";
import { computeRefundOutcomeStats } from "../lib/disputes/refundOutcomeStats";

const args = process.argv.slice(2);
const flag = (n: string) => args.indexOf(n);
const val = (n: string) => (flag(n) >= 0 ? args[flag(n) + 1] : undefined);
if (flag("--env-file") < 0) throw new Error("--env-file is required (prod = .env.production.local)");
const apply = flag("--apply") >= 0;
const limit = Number(val("--limit") ?? "3");

for (const line of fs.readFileSync(val("--env-file")!, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
function dec(b: string) {
  const [v, i, t, c] = b.split(":");
  const k = process.env[`TOKEN_ENCRYPTION_KEY_V${v.replace(/^v/, "")}`] || process.env.TOKEN_ENCRYPTION_KEY!;
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(k, "hex"), Buffer.from(i, "hex"));
  d.setAuthTag(Buffer.from(t, "hex"));
  return d.update(Buffer.from(c, "hex"), undefined, "utf8") + d.final("utf8");
}
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const API = process.env.SHOPIFY_API_VERSION || "2026-01";
console.log("supabase:", process.env.SUPABASE_URL, "| apply:", apply, "| limit:", limit);

const domains = new Map<string, string>();
const tokens = new Map<string, string>();
const candidates = await loadFinalReadCandidates(sb as never, limit);
console.log("candidates (no final read yet):", candidates.length);

const results: Array<{ disputeId: string; kind: string; settlements: number }> = [];
const summary = await runFinalReads(
  candidates,
  {
    now: () => Date.now(),
    readState: async (c) => {
      if (!tokens.has(c.shopId)) {
        const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", c.shopId).single();
        const { data: ses } = await sb
          .from("shop_sessions").select("access_token_encrypted").eq("shop_id", c.shopId)
          .eq("session_type", "offline").is("user_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!shop || !ses) throw new Error("no offline session");
        domains.set(c.shopId, shop.shop_domain);
        tokens.set(c.shopId, dec(ses.access_token_encrypted));
      }
      const r = await fetch(`https://${domains.get(c.shopId)}/admin/api/${API}/graphql.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": tokens.get(c.shopId)!, "Content-Type": "application/json" },
        body: JSON.stringify({ query: ORDER_REFUND_STATE_QUERY, variables: { id: c.orderGid } }),
      });
      const j: any = await r.json();
      if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200));
      await new Promise((res) => setTimeout(res, 250)); // gentle on the API
      const s = resolveRefundState(j.data.order, new Date());
      results.push({ disputeId: c.disputeId, kind: s.kind, settlements: s.settlements.length });
      return s;
    },
    saveFinal: async (c, s) => {
      if (apply) await upsertRefundState(sb as never, c.disputeId, c.shopId, c.orderGid, s, new Date().toISOString(), { finalRead: true });
    },
  },
  { budgetMs: 30 * 60 * 1000 },
);
console.log(JSON.stringify({ ...summary, wouldStoreOrStored: apply ? "stored" : "dry-run: nothing stored" }, null, 2));
console.log("kinds:", results.reduce<Record<string, number>>((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {}));

if (apply) {
  const { data: shops } = await sb.from("shops").select("id, shop_domain");
  for (const s of shops ?? []) {
    const rows = await loadRefundOutcomeRows(sb as never, s.id);
    const stats = computeRefundOutcomeStats(rows);
    if (stats.refunded.decided + stats.unrefunded.total > 0) console.log(s.shop_domain, JSON.stringify(stats));
  }
}
