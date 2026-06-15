/**
 * Ingest the merchant's *published* Shopify store policies into
 * policy_snapshots as the source of truth for policy evidence.
 *
 * Why: a policy only has weight with a bank if it was published and
 * visible to the customer, with a live URL we can cite. This reads
 * Shop.shopPolicies (the storefront footer links) and stores each as a
 * `shopify_published` snapshot carrying the live `published_url`. The
 * collector (lib/packs/sources/policySource.ts) then cites that URL,
 * directly answering Shopify's refundPolicyDisclosure question.
 *
 * Idempotent and safe to fire-and-forget:
 *   - dedup by (shop_id, policy_type, shopify_policy_id) on content_hash
 *     — a new snapshot is inserted only when the published text changed,
 *     so re-runs don't churn rows but a genuine edit is captured.
 *   - failures are logged and swallowed by callers; a miss just means
 *     the merchant's existing snapshots (if any) stand until next run.
 *
 * Trigger points:
 *   - OAuth callback (offline phase) — zero-effort pre-fill on install.
 *   - Pack build (defensive refresh) — a pack reflects current policies.
 *   - Manual "Refresh from store" action in the policies UI.
 *
 * Requires an offline session, so on install it MUST run after
 * storeSession (same constraint as persistShopCurrency).
 */

import crypto from "crypto";
import { getServiceClient } from "@/lib/supabase/server";
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";
import {
  SHOP_POLICIES_QUERY,
  mapShopPolicyType,
  type ShopPoliciesResponse,
} from "@/lib/shopify/queries/shopPolicies";

export interface IngestPoliciesResult {
  ok: boolean;
  /** Number of policies that produced a new or updated snapshot. */
  ingested: number;
  /** Number of published policies seen but unchanged since last run. */
  unchanged: number;
}

/** Strip HTML tags + collapse whitespace so extracted_text is readable
 *  plain text. ShopPolicy.body is HTML. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex");
}

export async function ingestShopifyPolicies(
  shopInternalId: string,
): Promise<IngestPoliciesResult> {
  try {
    const res = await makeAuthedRequest<ShopPoliciesResponse>({
      shopId: shopInternalId,
      query: SHOP_POLICIES_QUERY,
    });

    const policies = res.data?.shop?.shopPolicies;
    if (!policies) {
      // Empty data.shop is the schema-drift shape (see shopDetails.ts).
      console.warn("[ingestShopifyPolicies] empty data.shop from Shopify", {
        shopInternalId,
        errors: res.errors?.map((e) => e.message),
      });
      return { ok: false, ingested: 0, unchanged: 0 };
    }

    const sb = getServiceClient();
    let ingested = 0;
    let unchanged = 0;

    for (const policy of policies) {
      const policyType = mapShopPolicyType(policy.type);
      if (!policyType) continue; // LEGAL_NOTICE / TERMS_OF_SALE — not tracked

      const text = htmlToPlainText(policy.body ?? "");
      if (!text) continue; // policy slot exists but body is empty — nothing to cite

      const hash = contentHash(text);

      // Dedup: skip if the most recent published snapshot for this
      // Shopify policy already carries the same content hash.
      const { data: latest } = await sb
        .from("policy_snapshots")
        .select("content_hash")
        .eq("shop_id", shopInternalId)
        .eq("shopify_policy_id", policy.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latest?.content_hash === hash) {
        unchanged++;
        continue;
      }

      const { error: insertErr } = await sb.from("policy_snapshots").insert({
        shop_id: shopInternalId,
        policy_type: policyType,
        source: "shopify_published",
        published_url: policy.url,
        shopify_policy_id: policy.id,
        policy_updated_at: policy.updatedAt,
        extracted_text: text,
        content_hash: hash,
        captured_at: new Date().toISOString(),
      });

      if (insertErr) {
        console.warn("[ingestShopifyPolicies] insert failed", {
          shopInternalId,
          policyType,
          message: insertErr.message,
        });
        continue;
      }
      ingested++;
    }

    return { ok: true, ingested, unchanged };
  } catch (err) {
    console.warn(
      "[ingestShopifyPolicies] fetch/ingest threw",
      err instanceof Error ? err.message : err,
    );
    return { ok: false, ingested: 0, unchanged: 0 };
  }
}
