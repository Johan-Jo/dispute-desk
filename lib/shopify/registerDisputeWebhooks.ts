/**
 * Register dispute webhooks (disputes/create, disputes/update) for a shop
 * via Shopify GraphQL Admin API. Called after OAuth so new installs get
 * real-time dispute notifications.
 */

import { requestShopifyGraphQL } from "@/lib/shopify/graphql";

const DISPUTES_CREATE_MUTATION = `
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

export interface RegisterDisputeWebhooksResult {
  ok: boolean;
  created: string[];
  errors: string[];
}

/**
 * Register DISPUTES_CREATE and DISPUTES_UPDATE webhook subscriptions for the shop.
 * Does not throw; returns result with ok, created topics, and any errors.
 */
export async function registerDisputeWebhooks(params: {
  shopDomain: string;
  accessToken: string;
}): Promise<RegisterDisputeWebhooksResult> {
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
    { topic: "DISPUTES_CREATE", path: "/api/webhooks/disputes-create" },
    { topic: "DISPUTES_UPDATE", path: "/api/webhooks/disputes-update" },
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
      query: DISPUTES_CREATE_MUTATION,
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
      // Already registered (e.g. re-auth or previous install) — treat as success
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
