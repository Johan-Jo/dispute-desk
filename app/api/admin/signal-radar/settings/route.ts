import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import {
  getSignalRadarSettings,
  updateSignalRadarSettings,
  type SignalRadarSettings,
} from "@/lib/signal-radar/settings";

export const runtime = "nodejs";

const ALLOWED_KEYS: (keyof SignalRadarSettings)[] = [
  "shopify_community_enabled",
  "app_store_enabled",
  "reddit_enabled",
  "hackernews_enabled",
  "reddit_cron_enabled",
  "classify_cron_enabled",
];

export async function GET() {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const settings = await getSignalRadarSettings();
  return NextResponse.json(settings);
}

export async function PATCH(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const patch: Partial<SignalRadarSettings> = {};
  for (const key of ALLOWED_KEYS) {
    if (key in body && typeof body[key] === "boolean") {
      patch[key] = body[key] as boolean;
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }
  try {
    const next = await updateSignalRadarSettings(patch);
    return NextResponse.json(next);
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
