import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getCmsSettings, updateCmsSettings } from "@/lib/resources/admin-queries";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const settings = await getCmsSettings();
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

const ALLOWED_CMS_KEYS = new Set([
  "defaultPublishTimeUtc",
  "weekendsEnabled",
  "skipIfTranslationIncomplete",
  "minScheduledDaysWarning",
  "requireReviewerBeforePublish",
  "autopilotEnabled",
  "autopilotArticlesPerDay",
  "autopilotNotifyEmail",
  "autopilotStartedAt",
  "defaultCta",
  "generationSystemPrompt",
  "generationUserPromptSuffix",
  "generationLocaleInstructions",
  "generationContentTypeInstructions",
]);

export async function PUT(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
    }

    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED_CMS_KEYS.has(k)) sanitized[k] = v;
    }

    await updateCmsSettings(sanitized);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
