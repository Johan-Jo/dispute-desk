/**
 * Public, bank-facing evidence-attachment route.
 *
 * Handles `GET /e/<token>` from external reviewers (issuing banks,
 * Shopify's dispute view, etc.). Resolves the target file in Supabase
 * Storage using the service client and returns the bytes through our
 * origin. The Supabase storage host is never minted into a URL,
 * redirected to, or exposed in any response header.
 *
 * Two link formats are supported in the same path so old links keep
 * working through their TTL:
 *
 *   1. NEW — DB-backed Crockford Base32 short codes
 *      (`/e/Q7K2HXRJ9P`). See `lib/links/shortLinks.ts`. All new save
 *      jobs mint these.
 *
 *   2. LEGACY — HMAC-signed JWT-like tokens
 *      (`/e/<base64.payload>.<base64.signature>`). See
 *      `lib/links/attachmentLinks.ts`. Kept until existing live
 *      tokens expire (180 days from mint).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  requireEvidenceLinkSecret,
  verifyAttachmentToken,
} from "@/lib/links/attachmentLinks";
import { resolveShortLink, SHORT_CODE_RE } from "@/lib/links/shortLinks";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * Drop characters that would break a `Content-Disposition` filename
 * value (CRLF, quotes, semicolons) and collapse anything else outside
 * the safe alnum/dot/dash/underscore set into underscores. Cap length
 * so pathological inputs can't produce oversized headers.
 */
function sanitizeFileName(name: string | null | undefined): string {
  const fallback = "attachment";
  if (!name) return fallback;
  const cleaned = name
    .replace(/[\r\n"';]+/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 120);
  return cleaned || fallback;
}

function notFound(): NextResponse {
  return new NextResponse("Not found", { status: 404 });
}

interface ResolvedTarget {
  kind: "item" | "pdf";
  entityId: string;
  packId: string;
}

async function loadAndStream(
  db: SupabaseClient,
  target: ResolvedTarget,
): Promise<NextResponse> {
  let bucket: string;
  let path: string;
  let fileName: string | null = null;
  let contentType = "application/octet-stream";

  if (target.kind === "item") {
    const { data: item } = await db
      .from("evidence_items")
      .select("pack_id, source, payload")
      .eq("id", target.entityId)
      .single();
    if (
      !item ||
      item.pack_id !== target.packId ||
      item.source !== "manual_upload"
    ) {
      return notFound();
    }
    const meta = (item.payload ?? {}) as Record<string, unknown>;
    bucket = typeof meta.storageBucket === "string" ? meta.storageBucket : "";
    path = typeof meta.storagePath === "string" ? meta.storagePath : "";
    if (!bucket || !path) return notFound();
    if (typeof meta.fileName === "string") fileName = meta.fileName;
    if (typeof meta.fileType === "string") contentType = meta.fileType;
  } else {
    const { data: pack } = await db
      .from("evidence_packs")
      .select("id, pdf_path")
      .eq("id", target.packId)
      .single();
    if (!pack?.pdf_path) return notFound();
    bucket = "evidence-packs";
    path = pack.pdf_path;
    fileName = `evidence-pack-${String(pack.id).slice(0, 8)}.pdf`;
    contentType = "application/pdf";
  }

  const { data: blob, error } = await db.storage.from(bucket).download(path);
  if (error || !blob) return notFound();

  // Buffer the blob so we can set a reliable `Content-Length`. Uploads
  // are capped at 10 MB server-side, so this is bounded memory.
  const bytes = Buffer.from(await blob.arrayBuffer());

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${sanitizeFileName(fileName)}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const db = getServiceClient();

  // 1. Short-code path (new). Cheap shape check first to avoid an
  //    unnecessary DB roundtrip on legacy HMAC tokens.
  if (SHORT_CODE_RE.test(token)) {
    const target = await resolveShortLink(db, token);
    if (target) {
      return loadAndStream(db, target);
    }
    // Shape matched but row missing/expired/revoked — deny.
    return notFound();
  }

  // 2. Legacy HMAC-signed token path. Kept until existing live tokens
  //    expire (180 days from mint).
  let secret: string;
  try {
    secret = requireEvidenceLinkSecret();
  } catch {
    // Missing secret is an ops misconfiguration, not something the bank
    // can diagnose — surface as 404 so we never leak "why" to an
    // external caller.
    return notFound();
  }

  const payload = verifyAttachmentToken(token, secret);
  if (!payload) return notFound();

  return loadAndStream(db, {
    kind: payload.k,
    entityId: payload.id,
    packId: payload.p,
  });
}
