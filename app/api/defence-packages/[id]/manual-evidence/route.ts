/**
 * POST /api/defence-packages/:id/manual-evidence
 *
 * Promote an existing `evidence_items` row into this package's manual
 * evidence list. Used when a merchant has already uploaded a file (via
 * the standard pack upload route) and now wants to mark it bank-eligible
 * + include-in-narrative for the defence package.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";

export const runtime = "nodejs";

const BodySchema = z.object({
  evidenceItemId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  fileType: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  bankEligible: z.boolean().default(false),
  includeInPackage: z.boolean().default(true),
  includeInBankNarrative: z.boolean().default(false),
  evidenceCategory: z.string().max(120).nullable().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "Validation failed", details: err instanceof Error ? err.message : "unknown" },
      { status: 422 },
    );
  }

  const sb = getServiceClient();
  const { data: pkg } = await sb
    .from("defence_packages")
    .select("id, status, source_pack_id, shop_id, dispute_id, version")
    .eq("id", id)
    .eq("shop_id", shopId)
    .single();
  if (!pkg) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (pkg.status !== "draft") {
    return NextResponse.json(
      {
        error: `Cannot add manual evidence to a package in status=${pkg.status}.`,
        code: "INVALID_STATUS",
      },
      { status: 409 },
    );
  }

  const { error: upsertErr } = await sb
    .from("defence_manual_evidence")
    .upsert(
      {
        package_id: id,
        evidence_item_id: body.evidenceItemId,
        filename: body.filename,
        file_type: body.fileType ?? null,
        description: body.description ?? null,
        bank_eligible: body.bankEligible,
        include_in_package: body.includeInPackage,
        include_in_bank_narrative: body.includeInBankNarrative,
        evidence_category: body.evidenceCategory ?? null,
      },
      { onConflict: "package_id,evidence_item_id" },
    );
  if (upsertErr) {
    return NextResponse.json(
      { error: `Upsert failed: ${upsertErr.message}` },
      { status: 500 },
    );
  }

  await logAuditEvent({
    shopId: pkg.shop_id,
    disputeId: pkg.dispute_id,
    packId: pkg.source_pack_id,
    actorType: "merchant",
    eventType: "manual_evidence_added_to_package",
    eventPayload: {
      packageId: id,
      version: pkg.version,
      evidenceItemId: body.evidenceItemId,
      filename: body.filename,
      bankEligible: body.bankEligible,
    },
  });

  return NextResponse.json({ ok: true });
}
