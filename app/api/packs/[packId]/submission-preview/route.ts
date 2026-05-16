/**
 * GET /api/packs/[packId]/submission-preview
 *
 * Post-retirement shape (2026-05-16): mirrors the 4-field Shopify
 * mutation contract that `composeShopifyMutationPayload` emits at
 * submit time. The merchant's Review & Submit tab consumes this to
 * render the customer-info rows + the defence-package PDF attachment
 * row in `ExactDataSentCard`.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { composeShopifyMutationPayload } from "@/lib/shopify/composeShopifyMutationPayload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_PDF_GID = "preview://defence-package-pdf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ packId: string }> },
) {
  const { packId } = await params;
  const sb = getServiceClient();

  const { data: pack } = await sb
    .from("evidence_packs")
    .select("id, dispute_id")
    .eq("id", packId)
    .maybeSingle();
  if (!pack) {
    return NextResponse.json({ error: "Pack not found" }, { status: 404 });
  }

  const { data: dispute } = await sb
    .from("disputes")
    .select("customer_display_name, customer_email")
    .eq("id", pack.dispute_id)
    .maybeSingle();

  const { data: dpkg } = await sb
    .from("defence_packages")
    .select("id")
    .eq("dispute_id", pack.dispute_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const mutationPayload = composeShopifyMutationPayload({
    customer: {
      displayName: dispute?.customer_display_name ?? null,
      email: dispute?.customer_email ?? null,
    },
    defencePackagePdfGid: PREVIEW_PDF_GID,
  });

  if (!dpkg) {
    delete (mutationPayload as Record<string, unknown>).uncategorizedFile;
  }

  return NextResponse.json({ fields: [], mutationPayload });
}
