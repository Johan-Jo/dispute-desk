import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown",
]);
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "doc", "txt", "md"]);
const VALID_POLICY_TYPES = ["refunds", "shipping", "terms", "privacy", "contact"] as const;

/**
 * POST /api/policies/upload
 *
 * Body: FormData with file, shop_id, policy_type (refunds | shipping | terms | privacy | contact).
 * Uploads the file to policy-uploads bucket and inserts a policy_snapshots row.
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const shopId = formData.get("shop_id") as string | null;
  const policyType = formData.get("policy_type") as string | null;

  if (!file || !shopId || !policyType) {
    return NextResponse.json(
      { error: "file, shop_id, and policy_type are required" },
      { status: 400 }
    );
  }

  if (!VALID_POLICY_TYPES.includes(policyType as (typeof VALID_POLICY_TYPES)[number])) {
    return NextResponse.json(
      { error: "policy_type must be one of: refunds, shipping, terms, privacy, contact" },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024} MB` },
      { status: 400 }
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
  const isAllowedByMime = ALLOWED_TYPES.has(file.type);
  const isAllowedByExt = ALLOWED_EXTENSIONS.has(ext);
  if (!isAllowedByMime && !isAllowedByExt) {
    return NextResponse.json(
      { error: "Only PDF, DOCX, DOC, TXT, and Markdown files are allowed" },
      { status: 400 }
    );
  }
  const storagePath = `${shopId}/${policyType}/${Date.now()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const sb = getServiceClient();

  const { error: uploadErr } = await sb.storage
    .from("policy-uploads")
    .upload(storagePath, buffer, {
      contentType: file.type,
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
