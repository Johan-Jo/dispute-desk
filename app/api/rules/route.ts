import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { checkFeatureAccess } from "@/lib/billing/checkQuota";
import { validateBody, ruleCreateSchema } from "@/lib/middleware/validate";

export const runtime = "nodejs";

/**
 * GET /api/rules?shop_id=...
 * List all rules for a shop, ordered by priority.
 */
export async function GET(req: NextRequest) {
  const shopId =
    req.nextUrl.searchParams.get("shop_id") ?? req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("rules")
    .select("*")
    .eq("shop_id", shopId)
    .order("priority", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

/**
 * POST /api/rules
 * Create a new rule. Requires Starter or Pro plan.
 */
export async function POST(req: NextRequest) {
  const raw = await req.json();
  const body =
    raw && typeof raw === "object"
      ? {
          ...(raw as Record<string, unknown>),
          shop_id:
            (raw as { shop_id?: string }).shop_id ??
            req.headers.get("x-shop-id") ??
            undefined,
        }
      : raw;
  const validated = await validateBody(body, ruleCreateSchema);
  if ("error" in validated) return validated.error;
  const { shop_id, name, match, action, enabled, priority } = validated.data;

  const sb2 = getServiceClient();
  const { data: shop } = await sb2.from("shops").select("plan").eq("id", shop_id).single();
  const access = checkFeatureAccess(shop?.plan ?? "free", "rules");
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason, upgrade_required: true }, { status: 403 });
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("rules")
    .insert({
      shop_id,
      name: name ?? null,
      match: match ?? {},
      action: action ?? { mode: "review" },
      enabled: enabled ?? true,
      priority: priority ?? 0,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
