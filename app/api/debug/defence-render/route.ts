/**
 * GET /api/debug/defence-render?secret=...
 *
 * Synchronous PDF-render smoke test. Renders a literal hello-world PDF
 * inside the same prod runtime that buildDefencePackageJob uses. Returns
 * JSON with success + buffer size, OR error + stack.
 *
 * REMOVE ONCE THE PROD RENDER BUG IS UNDERSTOOD.
 */
import { NextRequest, NextResponse } from "next/server";
import React from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reactPdf = await import("@react-pdf/renderer");
    const { Document, Page, Text, renderToBuffer } = reactPdf;

    const element = React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4" },
        React.createElement(Text, null, "Hello world from prod"),
      ),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(element as any);
    return NextResponse.json({
      ok: true,
      size: Buffer.from(buffer).length,
      magic: Buffer.from(buffer).slice(0, 5).toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.slice(0, 4000) : "";
    return NextResponse.json({ ok: false, error: message, stack }, { status: 500 });
  }
}
