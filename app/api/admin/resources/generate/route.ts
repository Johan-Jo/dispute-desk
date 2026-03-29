import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { runGenerationPipeline } from "@/lib/resources/generation/pipeline";
import { isGenerationEnabled } from "@/lib/resources/generation/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGenerationEnabled()) {
    return NextResponse.json(
      { error: "Generation not enabled. Set GENERATION_ENABLED=true and OPENAI_API_KEY in environment." },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const archiveItemId = typeof body.archiveItemId === "string" ? body.archiveItemId : "";
  if (!archiveItemId) {
    return NextResponse.json({ error: "archiveItemId is required" }, { status: 400 });
  }

  try {
    const result = await runGenerationPipeline(archiveItemId);

    if (result.error) {
      return NextResponse.json(
        {
          error: result.error,
          results: result.results.map((r) => ({
            locale: r.locale,
            success: !!r.content,
            error: r.error,
            tokensUsed: r.tokensUsed,
          })),
        },
        { status: result.contentItemId ? 207 : 500 }
      );
    }

    return NextResponse.json({
      contentItemId: result.contentItemId,
      results: result.results.map((r) => ({
        locale: r.locale,
        success: !!r.content,
        tokensUsed: r.tokensUsed,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
