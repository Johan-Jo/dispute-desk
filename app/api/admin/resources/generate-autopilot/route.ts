import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getCmsSettings } from "@/lib/resources/admin-queries";
import { runGenerationPipeline } from "@/lib/resources/generation/pipeline";
import { isGenerationEnabled } from "@/lib/resources/generation/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  let settings: Record<string, unknown>;
  try {
    settings = await getCmsSettings();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load CMS settings" },
      { status: 500 }
    );
  }

  if (!settings.autopilotEnabled) {
    return NextResponse.json(
      {
        error:
          "Autopilot is off. Turn on AI Autopilot in Settings, or use Generate for the editorial draft flow.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await runGenerationPipeline(archiveItemId, {
      autopilot: true,
      autopilotDrainBacklog: false,
    });

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
