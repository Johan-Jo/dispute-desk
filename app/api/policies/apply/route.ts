import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

const VALID_POLICY_TYPES = ["refunds", "shipping", "terms", "privacy", "contact"] as const;
const MAX_CONTENT_LENGTH = 500 * 1024; // 500 KB

/**
 * POST /api/policies/apply
 *
 * Body: JSON { shop_id, policy_type, content }.
 * Saves the template content as a text file, uploads to policy-uploads, and creates a policy_snapshot.
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

  const { data: signed } = await sb.storage
    .from("policy-uploads")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year for portal use

  const url = signed?.signedUrl ?? null;
  if (!url) {
    return NextResponse.json(
      { error: "Failed to create signed URL" },
      { status: 500 }
    );
  }

  const { data: row, error: insertErr } = await sb
    .from("policy_snapshots")
    .insert({
      shop_id: shopId,
      policy_type: policyType,
      url,
      extracted_text: content,
      captured_at: new Date().toISOString(),
    })
    .select("id, url, policy_type")
    .single();

  if (insertErr) {
    return NextResponse.json(
      { error: `Failed to save policy record: ${insertErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json(row, { status: 201 });
}
