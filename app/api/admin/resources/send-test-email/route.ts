import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { sendPublishNotification } from "@/lib/email/sendPublishNotification";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!to) {
    return NextResponse.json({ error: "to is required" }, { status: 400 });
  }

  const result = await sendPublishNotification({
    to,
    articleTitle: "Test Article — DisputeDesk Email Check",
    articleSlug: "test-email-check",
    routeKind: "resources",
    pillar: "chargebacks",
    locale: "en-US",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
