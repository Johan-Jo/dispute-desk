/**
 * One-off: raise "add the bank's claim" on open disputes that already need
 * it (lib/disputes/bankClaim.ts) — reopened disputes and `general` ones with
 * no network reason code that pre-date the live trigger.
 *
 * Dry run by default: prints every dispute that needs the claim and whether
 * it is already answered. `--apply` raises the task (attention reason
 * `bank_claim_needed`). `--email` additionally sends the targeted email,
 * once per dispute and cycle (the same dedupe key the live path uses, so a
 * later live transition will not send it again). Always read the dry run
 * first; emails reach merchants.
 *
 *   node --env-file=.env.production.local node_modules/tsx/dist/cli.mjs \
 *     scripts/shopify/raise-bank-claims.ts [--shop <shop_id>] [--apply] [--email]
 */

import { getServiceClient } from "@/lib/supabase/server";
import {
  BANK_CLAIM_DISPUTE_COLUMNS,
  bankClaimInputFromRow,
  bankClaimTrigger,
  loadBankClaimAnswer,
} from "@/lib/disputes/bankClaim";
import { raiseBankClaimIfNeeded } from "@/lib/disputes/raiseBankClaim";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const SHOP = arg("--shop");
const APPLY = process.argv.includes("--apply");
const EMAIL = process.argv.includes("--email");
if (EMAIL && process.env.BANK_CLAIM_EMAILS_ENABLED !== "true") {
  console.error("--email needs BANK_CLAIM_EMAILS_ENABLED=true (the merchant email is switched off).");
  process.exit(1);
}

async function main() {
  const sb = getServiceClient();
  let q = sb
    .from("disputes")
    .select(`id, shop_id, order_name, attention_reason, ${BANK_CLAIM_DISPUTE_COLUMNS}`)
    .is("closed_at", null)
    .eq("status", "needs_response");
  if (SHOP) q = q.eq("shop_id", SHOP);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const shopDomains = new Map<string, string>();
  let needed = 0;
  for (const row of data ?? []) {
    const r = row as unknown as Record<string, unknown>;
    const trigger = bankClaimTrigger(bankClaimInputFromRow(r));
    if (!trigger) continue;
    needed++;
    const shopId = r.shop_id as string;
    if (!shopDomains.has(shopId)) {
      const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", shopId).single();
      shopDomains.set(shopId, (shop?.shop_domain as string) ?? shopId);
    }
    const answer = await loadBankClaimAnswer(sb, r.id as string, (r.response_cycle as number) ?? 1);
    const line =
      `${shopDomains.get(shopId)} ${r.order_name ?? r.id} trigger=${trigger} cycle=${r.response_cycle ?? 1} ` +
      `reason=${r.reason} code=${r.network_reason_code ?? "-"} due=${String(r.due_at).slice(0, 10)} ` +
      `answered=${answer ? "yes" : "no"} attention=${r.attention_reason ?? "-"}`;
    if (!APPLY || answer) {
      console.log(`  ${line}`);
      continue;
    }
    const res = await raiseBankClaimIfNeeded({
      shopId,
      disputeId: r.id as string,
      suppressEmail: !EMAIL,
      client: sb,
    });
    console.log(`  ${line} → marked=${res.marked} emailed=${res.emailed}`);
  }
  console.log(
    `\n${(data ?? []).length} open needs_response disputes scanned; ${needed} need the bank's claim` +
      (APPLY ? ` (applied${EMAIL ? ", emails sent where not already sent" : ", no email"})` : " (dry run)"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
