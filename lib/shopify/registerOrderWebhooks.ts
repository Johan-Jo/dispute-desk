/**
 * Register orders/* webhooks (orders/create, orders/updated) for a shop
 * via Shopify GraphQL Admin API (PR-A).
 *
 * Mirrors `registerDisputeWebhooks` — same retry/error semantics, same
 * "already exists" short-circuit on userErrors. Called from the OAuth
 * callback alongside the existing dispute-webhook registration.
 *
 * `orders/delete` is intentionally NOT subscribed (decision locked in
 * the plan): deleted orders remain in `shopify_orders` as historical
 * commercial events. GDPR scrub still happens via customers/redact.
 */

import { requestShopifyGraphQL } from "@/lib/shopify/graphql";

const ORDER_WEBHOOK_MUTATION = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id topic uri }
      userErrors { field message }
    }
  }
`;

function getBaseUrl(): string {
  const appUrl = process.env.SHOPIFY_APP_URL;
  if (appUrl) {
    return appUrl.replace(/\/$/, "");
  }
  const vercel = process.env.VERCEL_URL;
  if (vercel) {
    return `https://${vercel}`;
  }
  return "";
}

export interface RegisterOrderWebhooksResult {
  ok: boolean;
  created: string[];
  errors: string[];
}

export async function registerOrderWebhooks(params: {
  shopDomain: string;
  accessToken: string;
}): Promise<RegisterOrderWebhooksResult> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      created: [],
      errors: ["SHOPIFY_APP_URL or VERCEL_URL not set"],
    };
  }

  const session = {
    shopDomain: params.shopDomain,
    accessToken: params.accessToken,
  };

  const topics: { topic: string; path: string }[] = [
    { topic: "ORDERS_CREATE", path: "/api/webhooks/orders-create" },
    { topic: "ORDERS_UPDATED", path: "/api/webhooks/orders-updated" },
  ];

  const created: string[] = [];
  const errors: string[] = [];

  for (const { topic, path } of topics) {
    const uri = `${baseUrl}${path}`;
    const res = await requestShopifyGraphQL<{
      webhookSubscriptionCreate?: {
        webhookSubscription?: { id: string; topic: string; uri: string };
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>({
      session,
      query: ORDER_WEBHOOK_MUTATION,
      variables: {
        topic,
        webhookSubscription: { uri },
      },
    });

    const payload = res.data?.webhookSubscriptionCreate;
    if (res.errors?.length) {
      errors.push(`${topic}: ${res.errors.map((e) => e.message).join("; ")}`);
      continue;
    }
    if (payload?.userErrors?.length) {
      const msg = payload.userErrors.map((e) => e.message).join("; ");
      if (/already been taken|already exists/i.test(msg)) {
        created.push(topic);
      } else {
        errors.push(`${topic}: ${msg}`);
      }
      continue;
    }
    if (payload?.webhookSubscription?.id) {
      created.push(topic);
    }
  }

  return {
    ok: errors.length === 0,
    created,
    errors,
  };
}
