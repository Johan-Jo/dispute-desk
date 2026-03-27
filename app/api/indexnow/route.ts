import { NextResponse } from "next/server";

/**
 * IndexNow key verification endpoint.
 * Search engines verify domain ownership by fetching /{key}.txt
 * which we serve from /api/indexnow?key={key}.
 * The keyLocation in IndexNow submissions points here.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const indexNowKey = process.env.INDEXNOW_KEY;

  if (!indexNowKey || key !== indexNowKey) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(indexNowKey, {
    headers: { "Content-Type": "text/plain" },
  });
}
