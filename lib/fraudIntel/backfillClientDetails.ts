/**
 * Weekly CE3.0 device-element top-up.
 *
 * `Order.client_details` (browser_ip + user_agent) is REST-only — the live
 * order ingest is pure GraphQL, so new orders arrive WITHOUT user_agent.
 * Rather than add a REST call to the hot ingest path (which would cost a
 * second API round-trip on every order sync forever, for a CE3.0 signal
 * that currently qualifies on ~0 disputes — see
 * docs/plans/tech-debt/ce3-fraud-compelling-evidence.plan.md), a weekly
 * cron tops up recent orders. New orders get their device element within a
 * week; the hot path is untouched.
 *
 * Decorates EXISTING shopify_order_risk_signals rows only (the risk parser
 * owns row creation); never inserts, so it can't clobber parser_version.
 * Idempotent via `client_details_fetched_at`. Reuses the app's session +
 * token-refresh helpers rather than re-implementing crypto.
 *
 * The one-shot operator script scripts/backfill-order-client-details.mjs
 * covers full-history backfills; this module is the recurring top-up.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { loadSession } from "@/lib/shopify/sessionStorage";
import { ensureFreshSession } from "@/lib/shopify/sessions/refreshOfflineToken";

const API_VERSION = "2026-01";
const PAGE_SIZE = 250;

export interface ClientDetailsTopUpResult {
  shopId: string;
  shopDomain: string;
  scanned: number;
  updated: number;
  empty: number;
  skipped: number;
  noRow: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RestOrder {
  id: number;
  client_details?: {
    browser_ip?: string | null;
    user_agent?: string | null;
  } | null;
}

/**
 * Top up client_details for one shop's recent orders.
 *
 * @param sinceDays how far back to scan (default 14 — a fortnight covers a
 *   weekly cadence with overlap so a missed run self-heals).
 * @param maxPages safety cap on pages per shop per run.
 */
export async function topUpClientDetailsForShop(
  shopId: string,
  opts: { sinceDays?: number; maxPages?: number } = {},
): Promise<ClientDetailsTopUpResult> {
  const sinceDays = opts.sinceDays ?? 14;
  const maxPages = opts.maxPages ?? 20;
  const sb = getServiceClient();

  const base: ClientDetailsTopUpResult = {
    shopId,
    shopDomain: "",
    scanned: 0,
    updated: 0,
    empty: 0,
    skipped: 0,
    noRow: 0,
  };

  let session = await loadSession(shopId, "offline");
  if (!session) return { ...base, error: "no_offline_session" };
  // Refresh proactively if the expiring token is near/at expiry, using the
  // same path the rest of the app uses.
  try {
    session = await ensureFreshSession(session);
  } catch (e) {
    return { ...base, error: `refresh_failed: ${(e as Error).message}` };
  }
  base.shopDomain = session.shopDomain;

  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  let url: string | null =
    `https://${session.shopDomain}/admin/api/${API_VERSION}/orders.json` +
    `?status=any&limit=${PAGE_SIZE}&order=created_at+desc` +
    `&created_at_min=${encodeURIComponent(since)}` +
    `&fields=id,client_details`;

  for (let page = 0; page < maxPages && url; page++) {
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": session.accessToken },
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep(1500);
      continue; // re-fetch same url next loop
    }
    if (!res.ok) {
      return { ...base, error: `http_${res.status}` };
    }
    const orders: RestOrder[] = ((await res.json()) as { orders?: RestOrder[] })
      .orders ?? [];
    if (orders.length === 0) break;

    const gids = orders.map((o) => `gid://shopify/Order/${o.id}`);
    const { data: existing } = await sb
      .from("shopify_order_risk_signals")
      .select("shopify_order_id")
      .eq("shop_id", shopId)
      .in("shopify_order_id", gids)
      .not("client_details_fetched_at", "is", null);
    const alreadyFetched = new Set(
      (existing ?? []).map((r) => r.shopify_order_id as string),
    );

    const now = new Date().toISOString();
    for (const o of orders) {
      base.scanned++;
      const gid = `gid://shopify/Order/${o.id}`;
      if (alreadyFetched.has(gid)) {
        base.skipped++;
        continue;
      }
      const ip = o.client_details?.browser_ip || null;
      const ua = o.client_details?.user_agent || null;
      if (!ip && !ua) base.empty++;
      else base.updated++;

      // UPDATE-only: never insert (would need parser_version and clobber
      // the risk parser's row). Rows with no risk-signal row yet are left
      // for the parser; counted as noRow.
      const patch: Record<string, unknown> = {
        user_agent: ua,
        client_details_source: "cron_topup",
        client_details_fetched_at: now,
      };
      if (ip) patch.client_ip = ip; // never null out an existing ip
      const { data, error } = await sb
        .from("shopify_order_risk_signals")
        .update(patch)
        .eq("shop_id", shopId)
        .eq("shopify_order_id", gid)
        .select("id");
      if (error) return { ...base, error: `update_failed: ${error.message}` };
      if (!data || data.length === 0) base.noRow++;
    }

    const link = res.headers.get("link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    await sleep(600); // stay under the 2 req/s REST bucket
  }

  return base;
}
