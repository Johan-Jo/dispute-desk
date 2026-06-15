import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

const VALID_POLICY_TYPES = ["refunds", "shipping", "terms", "privacy", "contact"] as const;
const MAX_CONTENT_LENGTH = 500 * 1024; // 500 KB

/**
 * POST /api/policies/apply
 *
 * Body: JSON { shop_id, policy_type, content }.
 * Saves a TEMPLATE DRAFT — the merchant previewed/edited one of our
 * library templates. Stored as `source = 'template'`, which the
 * evidence collector (lib/packs/sources/policySource.ts) deliberately
 * EXCLUDES from bank evidence: a DB-only template has no storefront URL
 * to cite. The merchant must publish it on their store (then we
 * re-capture it via ingestShopifyPolicies as `shopify_published`)
 * before it counts. This endpoint keeps the preview/edit-before-copy
 * UX working; it no longer writes bank-facing evidence.
 */
export async function POST(req: NextRequest) {
  let body: { shop_id?: string; policy_type?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const shopId = body.shop_id;
  const policyType = body.policy_type;
  const content = typeof body.content === "string" ? body.content : "";

  if (!shopId || !policyType) {
    return NextResponse.json(
      { error: "shop_id and policy_type are required" },
      { status: 400 }
    );
  }

  if (!VALID_POLICY_TYPES.includes(policyType as (typeof VALID_POLICY_TYPES)[number])) {
    return NextResponse.json(
      { error: "policy_type must be one of: refunds, shipping, terms, privacy, contact" },
      { status: 400 }
    );
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: `Content too long. Max ${MAX_CONTENT_LENGTH / 1024} KB` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(content, "utf-8");
  const storagePath = `${shopId}/${policyType}/${Date.now()}.txt`;
  const sb = getServiceClient();

  const { error: uploadErr } = await sb.storage
    .from("policy-uploads")
    .upload(storagePath, buffer, {
      contentType: "text/plain",
      upsert: false,
    });

  if (uploadErr) {
    return NextResponse.json(
      { error: `Upload failed: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  // No signed URL is persisted — files are served via the proxy at
  // `/api/policies/[id]/file`. See migration
  // 20260519015032_policy_snapshots_storage_path.sql.
  const { data: row, error: insertErr } = await sb
    .from("policy_snapshots")
    .insert({
      shop_id: shopId,
      policy_type: policyType,
      // Template draft — NOT bank evidence. See route docblock.
      source: "template",
      storage_path: storagePath,
      extracted_text: content,
      captured_at: new Date().toISOString(),
    })
    .select("id, policy_type")
    .single();

  if (insertErr) {
    return NextResponse.json(
      { error: `Failed to save policy record: ${insertErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json(row, { status: 201 });
}
