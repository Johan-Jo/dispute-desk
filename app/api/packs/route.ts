import { NextRequest, NextResponse } from "next/server";
import { listPacks, createPack } from "@/lib/db/packs";

/**
 * GET /api/packs?shopId=...&status=DRAFT&q=search
 *
 * Lists all packs for a shop from the new `packs` table.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const shopId = searchParams.get("shopId");

  if (!shopId) {
    return NextResponse.json({ error: "shopId required" }, { status: 400 });
  }

  const packs = await listPacks(shopId, {
    status: searchParams.get("status") ?? undefined,
    search: searchParams.get("q") ?? undefined,
  });

  return NextResponse.json({ packs });
}

/**
 * POST /api/packs
 *
 * Body: { shopId, name, disputeType, code? }
 *
 * Creates a manual pack (source = MANUAL).
 */
export async function POST(req: NextRequest) {
  let body: { shopId?: string; name?: string; disputeType?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.shopId || !body.name || !body.disputeType) {
    return NextResponse.json(
      { error: "shopId, name, and disputeType are required" },
      { status: 400 }
    );
  }

  const pack = await createPack(body.shopId, {
    name: body.name,
    disputeType: body.disputeType,
    code: body.code,
  });

  if (!pack) {
    return NextResponse.json(
      { error: "Failed to create pack" },
      { status: 500 }
    );
  }

  return NextResponse.json(pack, { status: 201 });
}
