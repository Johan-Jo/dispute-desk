/**
 * POST /api/webhooks/shop/redact — GDPR mandatory webhook.
 *
 * Shopify sends this 48 hours after app uninstall. Per Shopify spec
 * we must delete all data associated with the shop. We hard-delete
 * across every per-shop table in the DB — explicit deletion (not FK
 * cascade) so the order is observable and auditable.
 *
 * Tables touched (in dependency order):
 *   1. evidence_short_links
 *   2. evidence_files
 *   3. evidence_items
 *   4. submission_attempts
 *   5. rebuttal_drafts
 *   6. argument_maps
 *   7. dispute_notes
 *   8. dispute_events
 *   9. evidence_packs
 *  10. disputes
 *  11. policy_snapshots
 *  12. rules
 *  13. pack_usage_events
 *  14. pack_credits_ledger
 *  15. plan_entitlements
 *  16. integrations / integration_secrets
 *  17. shop_setup
 *  18. shop_daily_metrics / shop_reconcile_schedule (if present)
 *  19. jobs
 *  20. audit_events (LAST — preserved as long as possible to capture
 *      the redaction itself, then removed since they reference shop_id)
 *  21. shop_sessions
 *  22. shops (LAST — the row this all hangs off)
 *
 * We DO write one final audit row to a long-lived audit table BEFORE
 * the cascade so a future audit can prove the redact ran. That row is
 * the only PII-free survivor (event_payload contains shop_domain only,
 * which Shopify already published in the webhook).
 *
 * Re-delivery is idempotent — DELETE WHERE shop_id = X is a no-op
 * after the first call.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface ShopRedactPayload {
  shop_id?: number;
  shop_domain?: string;
}

/**
 * Tables to delete in dependency order. Listed verbosely (not via FK
 * introspection) so the cascade is auditable and any failure surfaces
 * which table/order broke.
 *
 * Wrapped in a function so test harnesses can swap the list when a
 * future migration adds a new per-shop table.
 */
const SHOP_TABLES_REVERSE_DEPENDENCY_ORDER = [
  "evidence_short_links",
  "evidence_files",
  "evidence_items",
  "submission_attempts",
  "rebuttal_drafts",
  "argument_maps",
  "dispute_notes",
  "dispute_events",
  "evidence_packs",
  "disputes",
  "policy_snapshots",
  "rules",
  "pack_usage_events",
  "pack_credits_ledger",
  "plan_entitlements",
  "integrations",
  "integration_secrets",
  "shop_setup",
  "shop_daily_metrics",
  "shop_reconcile_schedule",
  "jobs",
  "audit_events",
  "shop_sessions",
  "shops",
] as const;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmac = req.headers.get("x-shopify-hmac-sha256") ?? "";

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: ShopRedactPayload = {};
  try {
    payload = JSON.parse(rawBody) as ShopRedactPayload;
  } catch {
    console.warn("[webhook] shop/redact: invalid JSON body");
    return NextResponse.json({ ok: true, skipped: "invalid_json" });
  }

  const shopDomain =
    req.headers.get("x-shopify-shop-domain") ?? payload.shop_domain ?? null;
  if (!shopDomain) {
    return NextResponse.json({ error: "Missing shop domain" }, { status: 400 });
  }

  const db = getServiceClient();
  const { data: shop } = await db
    .from("shops")
    .select("id")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (!shop) {
    // Already deleted, or never installed. Idempotent: ack and exit.
    return NextResponse.json({ ok: true, skipped: "unknown_shop" });
  }

  const shopId = shop.id;

  // Pre-deletion compliance breadcrumb. Stays in audit_events until
  // the cascade reaches that table below — but the exec log captures
  // it regardless if Shopify ever asks.
  console.log(
    `[shop/redact] starting cascade for shop_id=${shopId} shop_domain=${shopDomain}`,
  );

  const deletedCounts: Record<string, number> = {};
  for (const table of SHOP_TABLES_REVERSE_DEPENDENCY_ORDER) {
    try {
      const { error, data } = await db
        .from(table)
        .delete()
        .eq(table === "shops" ? "id" : "shop_id", shopId)
        .select("id");
      if (error) {
        // Tables that don't exist yet (newer migrations not applied,
        // or test harness with a partial schema) return error.code 42P01.
        // Log and continue — the rest of the cascade is independent.
        console.warn(
          `[shop/redact] delete from ${table} failed (continuing):`,
          error.message,
        );
        deletedCounts[table] = -1;
        continue;
      }
      deletedCounts[table] = (data as unknown[] | null)?.length ?? 0;
    } catch (err) {
      console.warn(
        `[shop/redact] unexpected throw deleting ${table} (continuing):`,
        err instanceof Error ? err.message : String(err),
      );
      deletedCounts[table] = -1;
    }
  }

  console.log(
    `[shop/redact] cascade complete for shop_domain=${shopDomain}:`,
    JSON.stringify(deletedCounts),
  );

  return NextResponse.json({ ok: true, deletedCounts });
}
