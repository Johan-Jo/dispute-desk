import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/admin/auth";
import { simulatePolicy, type SimulationInput } from "@/lib/intelligence/simulator/simulate";
import { POLICY_TEMPLATES } from "@/lib/intelligence/simulator/templates";

export const runtime = "nodejs";

/** GET — list available policy templates. */
export async function GET() {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    templates: POLICY_TEMPLATES.map((t) => ({ key: t.key, label: t.label, description: t.description })),
  });
}

/** POST — run a policy simulation for a shop segment. */
export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const shopId = typeof body.shopId === "string" ? body.shopId.trim() : "";
  if (!shopId) return NextResponse.json({ error: "shopId required" }, { status: 400 });

  const input = body.input as SimulationInput | undefined;
  if (!input || !input.currency || !input.effectiveness || !input.costs) {
    return NextResponse.json({ error: "input (currency, filters, effectiveness, costs) required" }, { status: 400 });
  }

  try {
    const result = await simulatePolicy(shopId, input);
    return NextResponse.json({ result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
