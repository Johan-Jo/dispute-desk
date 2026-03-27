import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin/auth";
import { getContentList } from "@/lib/resources/admin-queries";

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
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSize = Math.min(
    parseInt(url.searchParams.get("pageSize") ?? "20", 10),
    100
  );

  try {
    const result = await getContentList({ status, contentType, topic, search, page, pageSize });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
