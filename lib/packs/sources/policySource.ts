/**
 * Policy snapshot evidence source collector.
 *
 * Reads policy_snapshots from the database for the shop.
 * Contributes shipping_policy, refund_policy, cancellation_policy.
 *
 * SOURCE OF TRUTH: only policies that are *published* (or otherwise
 * citable) become bank evidence. A policy is citable when it has a
 * source of `shopify_published` (read live off the store, with a live
 * `published_url`), `uploaded`, or `external_url`. Template drafts
 * (`source = 'template'`) are excluded — a DB-only template has no
 * storefront URL to cite, so it answers none of Shopify's
 * "where did the customer see this policy?" (refundPolicyDisclosure).
 *
 * Before reading, we run a defensive refresh of the published policies
 * from Shopify so a pack always reflects the merchant's current live
 * policies (e.g. they published a template since install).
 *
 * IMPORTANT: All evidence submitted to Shopify must be in English.
 * Policy snapshots capture the store's current policy text, which may
 * be in the store's language. If policies are not in English, the
 * merchant must upload English versions before submission.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { ingestShopifyPolicies } from "@/lib/policies/ingestShopifyPolicies";
import type { EvidenceSection, BuildContext } from "../types";

type PolicyFieldKey = "refund_policy" | "shipping_policy" | "cancellation_policy";

const POLICY_FIELD_MAP: Record<string, PolicyFieldKey> = {
  shipping: "shipping_policy",
  refunds: "refund_policy",
  terms: "cancellation_policy",
};

/** Sources whose snapshots are citable bank evidence. Template drafts
 *  are deliberately absent — they have no storefront URL to cite. */
const EVIDENCE_ELIGIBLE_SOURCES = new Set([
  "shopify_published",
  "uploaded",
  "external_url",
]);

export async function collectPolicyEvidence(
  ctx: BuildContext
): Promise<EvidenceSection[]> {
  const sb = getServiceClient();

  // Defensive refresh: pull current published policies so the pack
  // reflects what's live on the store right now. Idempotent + graceful
  // — a miss just means we read whatever snapshots already exist.
  await ingestShopifyPolicies(ctx.shopId);

  const { data: policies } = await sb
    .from("policy_snapshots")
    .select(
      "id, policy_type, source, published_url, storage_path, content_hash, extracted_text, captured_at",
    )
    .eq("shop_id", ctx.shopId)
    .order("captured_at", { ascending: false });

  if (!policies?.length) return [];

  // Only citable sources count as evidence; drop template drafts.
  const eligible = policies.filter((p) =>
    EVIDENCE_ELIGIBLE_SOURCES.has(p.source ?? "uploaded"),
  );
  if (!eligible.length) return [];

  // Deduplicate: keep only the most recent per policy_type
  const latest = new Map<string, (typeof eligible)[0]>();
  for (const p of eligible) {
    if (!latest.has(p.policy_type)) {
      latest.set(p.policy_type, p);
    }
  }

  const fieldsProvided: string[] = [];
  const policyEntries: Record<string, unknown>[] = [];

  for (const [type, policy] of latest) {
    const field = POLICY_FIELD_MAP[type];
    if (field) fieldsProvided.push(field);

    policyEntries.push({
      policySnapshotId: policy.id,
      policyType: type,
      // Provenance + the citable "where". publishedUrl is the live
      // storefront URL the PDF cites to answer Shopify's
      // refundPolicyDisclosure ("where did the customer see this?").
      source: policy.source ?? "uploaded",
      publishedUrl: policy.published_url ?? null,
      // Carry the storage path through the pipeline. The PDF builder
      // and UI never expose this directly to the bank or merchant —
      // it's used only for server-side lookups. Signed URLs are
      // never stored.
      storagePath: policy.storage_path,
      capturedAt: policy.captured_at,
      contentHash: policy.content_hash,
      textPreview: policy.extracted_text?.slice(0, 500) ?? null,
      textLength: policy.extracted_text?.length ?? 0,
    });
  }

  // Per-type display-only sections so the Evidence tab can render
  // individual policy rows (refund / shipping / cancellation). These
  // carry no fieldsProvided because the combined section above already
  // owns that signal, and they intentionally produce empty output from
  // the Shopify serializer so they don't double-emit into Shopify
  // (see the empty-string filter in buildEvidenceInputFromRaw).
  const PER_TYPE_LABEL_KEY: Record<string, string> = {
    refunds: "packs.section.refundPolicy",
    shipping: "packs.section.shippingPolicy",
    terms: "packs.section.cancellationPolicy",
  };
  const perTypeSections: EvidenceSection[] = [];
  for (const [type, policy] of latest) {
    const field = POLICY_FIELD_MAP[type];
    if (!field) continue;
    perTypeSections.push({
      type: field,
      labelToken: { key: PER_TYPE_LABEL_KEY[type] ?? `packs.section.legacy.${field}` },
      source: "policy_snapshots",
      fieldsProvided: [],
      data: {
        __displayOnly: true,
        policies: [
          {
            policySnapshotId: policy.id,
            policyType: type,
            source: policy.source ?? "uploaded",
            publishedUrl: policy.published_url ?? null,
            storagePath: policy.storage_path,
            capturedAt: policy.captured_at,
            textPreview: policy.extracted_text?.slice(0, 500) ?? null,
          },
        ],
      },
    });
  }

  return [
    {
      type: "policy",
      labelToken: {
        key: "packs.section.storePolicies",
        params: { count: policyEntries.length },
      },
      source: "policy_snapshots",
      fieldsProvided,
      data: { policies: policyEntries },
    },
    ...perTypeSections,
  ];
}
