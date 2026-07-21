import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/admin/auth";
import { getRecommendationById, setExplanation } from "@/lib/intelligence/recommendations";
import { explainRecommendation } from "@/lib/intelligence/llm/explain";

export const runtime = "nodejs";

/** POST { recommendationId } — generate merchant-friendly prose from the
 *  validated recommendation object (LLM explains only; never recalculates). */
export async function POST(req: NextRequest) {
  const user = await getAdminSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = typeof body.recommendationId === "string" ? body.recommendationId : "";
  if (!id) return NextResponse.json({ error: "recommendationId required" }, { status: 400 });

  const rec = await getRecommendationById(id);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { prose, model, error } = await explainRecommendation(rec);
  if (error || !prose) return NextResponse.json({ error: error ?? "No output" }, { status: 502 });

  await setExplanation(id, prose, model);
  return NextResponse.json({ prose, model });
}
