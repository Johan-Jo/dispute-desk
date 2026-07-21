import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/admin/auth";
import { getRun } from "@/lib/intelligence/runs";
import { listRecommendations } from "@/lib/intelligence/recommendations";
import { buildMarkdownReport } from "@/lib/intelligence/export/report";
import { getServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** GET — export the run as a self-contained markdown Intelligence Report. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const recommendations = await listRecommendations(id, run.shop_id);
  const { data: shop } = await getServiceClient().from("shops").select("shop_domain").eq("id", run.shop_id).maybeSingle();
  const shopLabel = shop?.shop_domain ?? run.shop_id;

  const md = buildMarkdownReport(run as never, recommendations, shopLabel);
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="intelligence-report-${id.slice(0, 8)}.md"`,
    },
  });
}
