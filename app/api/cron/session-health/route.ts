/**
 * GET /api/cron/session-health — the watchdog for shop connectivity.
 *
 * Two silent failures took Mein Maison (6a8848-dd) off the air on
 * 2026-08-30, and NOTHING alerted for ~20 hours:
 *
 *   1. Expiring offline tokens live ONE HOUR. `ensureFreshSession()`
 *      refreshes them, but only ever ran as a side effect of other
 *      traffic (shop-update webhooks, orders reconciliation). A shop
 *      with no order webhooks got no traffic, so nothing ever refreshed
 *      it — the token expired and stayed expired. Dispute sync then
 *      failed ~50% of runs while still reporting `succeeded`, because
 *      syncDisputes collects GraphQL errors into SyncResult instead of
 *      throwing.
 *   2. Its orders/create + orders/updated subscriptions were missing
 *      entirely (4 of 8 live shops were), so no order data arrived at
 *      all — and the expired token hid that from every diagnostic.
 *
 * This route makes both conditions impossible to sit unnoticed:
 *
 *   - PROACTIVE REFRESH. Every installed shop's offline session is run
 *     through `ensureFreshSession()` hourly. Tokens live 60 min and
 *     `needsRefresh()` fires at 5 min of headroom, so an hourly sweep
 *     renews every token around mid-life. A shop that receives zero
 *     traffic now stays connected on this sweep alone.
 *   - VERIFY, DO NOT ASSUME. Asks Shopify what is actually subscribed
 *     and re-registers anything missing. Registration at install is
 *     fire-and-forget (the OAuth callback logs failures and moves on),
 *     so "we called create once" is not evidence a webhook exists.
 *   - IT IS LOUD. Anything unresolved after a repair attempt writes an
 *     `audit_events` row (`session_health_alert`) AND emails ops. The
 *     original outage produced no error anywhere — that is the actual
 *     defect this route exists to close.
 *
 * Safe to run often: refresh is a no-op outside the skew window, and the
 * webhook check is one cheap query per shop.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { cronEnvGate } from "@/lib/cron/envGate";
import { loadSession } from "@/lib/shopify/sessionStorage";
import { ensureFreshSession } from "@/lib/shopify/sessions/refreshOfflineToken";
import { registerOrderWebhooks } from "@/lib/shopify/registerOrderWebhooks";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { sendAdminEmail } from "@/lib/email/adminEmail";

export const runtime = "nodejs";

/** Topics a shop MUST carry for order data to flow at all. */
const REQUIRED_ORDER_TOPICS = ["ORDERS_CREATE", "ORDERS_UPDATED"] as const;

const SUBSCRIPTIONS_QUERY = /* GraphQL */ `
  query ShopWebhookSubscriptions {
    webhookSubscriptions(first: 50) {
      edges {
        node {
          topic
        }
      }
    }
  }
`;

interface ShopHealth {
  shopDomain: string;
  /** "failed" is the state that pages a human. */
  state: "ok" | "repaired" | "failed";
  tokenRefreshed: boolean;
  /** Proven by a live Admin API call, not inferred from the refresh. */
  tokenLive: boolean;
  webhooksRegistered: string[];
  problems: string[];
}

async function readSubscribedTopics(
  shopDomain: string,
  accessToken: string,
): Promise<{ topics: string[]; errors: string[] }> {
  const res = await requestShopifyGraphQL<{
    webhookSubscriptions?: { edges: Array<{ node: { topic: string } }> };
  }>({
    session: { shopDomain, accessToken },
    query: SUBSCRIPTIONS_QUERY,
    variables: {},
  });
  return {
    topics: (res.data?.webhookSubscriptions?.edges ?? []).map(
      (e) => e.node.topic,
    ),
    errors: (res.errors ?? []).map((e) => e.message),
  };
}

export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();
  const { data: shops, error } = await sb
    .from("shops")
    .select("id, shop_domain")
    .is("uninstalled_at", null)
    .order("shop_domain");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: ShopHealth[] = [];

  for (const shop of shops ?? []) {
    const health: ShopHealth = {
      shopDomain: shop.shop_domain,
      state: "ok",
      tokenRefreshed: false,
      tokenLive: false,
      webhooksRegistered: [],
      problems: [],
    };

    try {
      const stored = await loadSession(shop.id, "offline");
      if (!stored) {
        health.state = "failed";
        health.problems.push("no offline session");
        results.push(health);
        continue;
      }

      // ── 1. Keep the access token alive ──────────────────────────
      // ensureFreshSession never throws: on failure it logs and returns
      // the STALE session. Compare tokens to see what actually happened,
      // then prove the outcome with a live call below.
      const session = await ensureFreshSession(stored);
      health.tokenRefreshed = session.accessToken !== stored.accessToken;

      // ── 2. Prove the token works AND read subscriptions ─────────
      // One query answers both questions. Reading subscriptions was
      // impossible while the token was dead, which is precisely how the
      // missing-webhook fault stayed hidden behind the expiry fault.
      const first = await readSubscribedTopics(
        shop.shop_domain,
        session.accessToken,
      );
      if (first.errors.length) {
        // A refresh that "succeeded" yet still yields a rejected token
        // is the exact state that hid this outage. Never silent.
        health.state = "failed";
        health.problems.push(
          `admin API unreachable: ${first.errors.join("; ")}`,
        );
        results.push(health);
        continue;
      }
      health.tokenLive = true;

      // ── 3. Verify + repair order webhooks ───────────────────────
      const missing = REQUIRED_ORDER_TOPICS.filter(
        (t) => !first.topics.includes(t),
      );

      if (missing.length) {
        health.problems.push(`missing webhooks: ${missing.join(", ")}`);
        const reg = await registerOrderWebhooks({
          shopDomain: shop.shop_domain,
          accessToken: session.accessToken,
        });
        health.webhooksRegistered = reg.created;

        // Trust a re-read, not the mutation's own report.
        const after = await readSubscribedTopics(
          shop.shop_domain,
          session.accessToken,
        );
        const stillMissing = REQUIRED_ORDER_TOPICS.filter(
          (t) => !after.topics.includes(t),
        );
        if (stillMissing.length) {
          health.state = "failed";
          health.problems.push(
            `re-registration did not stick: ${stillMissing.join(", ")}` +
              (reg.errors.length ? ` (${reg.errors.join("; ")})` : ""),
          );
        } else {
          health.state = "repaired";
        }
      } else if (health.tokenRefreshed) {
        health.state = "repaired";
      }
    } catch (err) {
      health.state = "failed";
      health.problems.push(
        `unexpected: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    results.push(health);
  }

  // ── 4. Be loud about anything still broken ─────────────────────
  const failed = results.filter((r) => r.state === "failed");
  const repaired = results.filter((r) => r.state === "repaired");

  if (failed.length) {
    // Persist first — the email helper swallows its own failures.
    await sb.from("audit_events").insert(
      failed.map((f) => ({
        shop_id: null,
        actor_type: "system" as const,
        event_type: "session_health_alert",
        event_payload: {
          shop_domain: f.shopDomain,
          problems: f.problems,
          token_refreshed: f.tokenRefreshed,
          token_live: f.tokenLive,
        },
      })),
    );

    const lines = failed.map(
      (f) => `- ${f.shopDomain}: ${f.problems.join("; ")}`,
    );
    const intro =
      "These shops cannot reach the Shopify Admin API, or are missing order " +
      "webhooks that could not be repaired automatically. Until fixed they " +
      "receive no order data and dispute sync may fail silently.";
    await sendAdminEmail({
      subject: `[DisputeDesk] Session health: ${failed.length} shop(s) disconnected`,
      text: `${intro}\n\n${lines.join("\n")}\n`,
      html:
        `<p>${intro}</p><ul>` +
        failed
          .map(
            (f) =>
              `<li><strong>${f.shopDomain}</strong>: ${f.problems.join("; ")}</li>`,
          )
          .join("") +
        `</ul>`,
      logTag: "session-health",
    });
  }

  return NextResponse.json({
    checked: results.length,
    ok: results.filter((r) => r.state === "ok").length,
    repaired: repaired.length,
    failed: failed.length,
    results,
  });
}
