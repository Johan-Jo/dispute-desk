// READ-ONLY dry run of the refund-state check against a real environment: reads Shopify live, decides, prints.
// Writes nothing (dryRun) and sends nothing. Usage:
//   npx tsx scripts/shopify/dry-run-refund-state-check.mts --env-file .env.production.local
import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ORDER_REFUND_STATE_QUERY } from "../../lib/shopify/queries/orderRefundState";
import { resolveRefundState } from "../../lib/disputes/refundState";
import { runRefundStateCheck } from "../../lib/disputes/refundStateCheck";
import { loadRefundCheckCandidates } from "../../lib/disputes/loadRefundCheckCandidates";

const args = process.argv.slice(2);
const envIdx = args.indexOf("--env-file");
if (envIdx < 0) throw new Error("--env-file is required (prod = .env.production.local)");
for (const line of fs.readFileSync(args[envIdx + 1], "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
function dec(b: string) {
  const [v, i, t, c] = b.split(":");
  const ver = v.replace(/^v/, "");
  const k = process.env[`TOKEN_ENCRYPTION_KEY_V${ver}`] || process.env.TOKEN_ENCRYPTION_KEY!;
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(k, "hex"), Buffer.from(i, "hex"));
  d.setAuthTag(Buffer.from(t, "hex"));
  return d.update(Buffer.from(c, "hex"), undefined, "utf8") + d.final("utf8");
}
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const API = process.env.SHOPIFY_API_VERSION || "2026-01";
console.log("supabase:", process.env.SUPABASE_URL);

const domains = new Map<string, string>();
const tokens = new Map<string, string>();

const candidates = await loadRefundCheckCandidates(sb as never, { skipStates: true });
console.log("candidates:", candidates.length);

const summary = await runRefundStateCheck(
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
      return resolveRefundState(j.data.order, new Date());
    },
    saveState: async () => { throw new Error("dry run must not write"); },
    send: async () => { throw new Error("dry run must not send"); },
    recordSent: async () => { throw new Error("dry run must not write"); },
  },
  { emailsEnabled: true, dryRun: true, budgetMs: 240_000, perShopCap: 5, minRecheckMs: 0 },
);
console.log(JSON.stringify(summary, null, 2));
