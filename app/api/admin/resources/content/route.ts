import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getContentList } from "@/lib/resources/admin-queries";
import { HUB_CONTENT_LOCALES } from "@/lib/resources/constants";
import type { HubContentLocale } from "@/lib/resources/constants";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl;
  const status = url.searchParams.get("status") ?? undefined;
  const contentType = url.searchParams.get("contentType") ?? undefined;
  const topic = url.searchParams.get("topic") ?? undefined;
  const search = url.searchParams.get("search") ?? undefined;
  const localeRaw = url.searchParams.get("locale");
  let locale: string | undefined;
  if (localeRaw === null || localeRaw === "" || localeRaw === "all") {
    locale = localeRaw === "all" ? "all" : undefined;
  } else if (HUB_CONTENT_LOCALES.includes(localeRaw as HubContentLocale)) {
    locale = localeRaw;
  } else {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.max(1, Math.min(parseInt(url.searchParams.get("pageSize") ?? "20", 10) || 20, 100));

  try {
    const result = await getContentList({ status, contentType, topic, search, locale, page, pageSize });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
