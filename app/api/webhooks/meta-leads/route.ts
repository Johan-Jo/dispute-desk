import { NextRequest, NextResponse } from "next/server";
import { extractLeadgenChanges, verifyMetaSignature } from "@/lib/marketing/metaLeads/webhookAuth";
import { processMetaLead } from "@/lib/marketing/metaLeads/ingest";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Meta Instant Form lead webhook.
 *
 * GET  — Meta's one-time subscription handshake: echo `hub.challenge` when `hub.verify_token`
 *        matches META_WEBHOOK_VERIFY_TOKEN.
 * POST — one notification per new lead (`field: "leadgen"`). The body is verified against
 *        `X-Hub-Signature-256` (META_APP_SECRET) before anything runs. Processing is AWAITED:
 *        Vercel freezes the instance as soon as the response returns. A failed fetch/store returns
 *        500 so Meta retries; duplicate deliveries are no-ops (unique `leadgen_id`).
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.META_APP_SECRET?.trim() ?? "";
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  const expectedPage = process.env.META_PAGE_ID?.trim();
  const changes = extractLeadgenChanges(payload).filter(
    (c) => !expectedPage || !c.pageId || c.pageId === expectedPage,
  );

  const results: string[] = [];
  for (const change of changes) {
    try {
      results.push(await processMetaLead({ leadgenId: change.leadgenId, formId: change.formId }));
    } catch (err) {
      console.error("[meta-leads-webhook] failed:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "processing failed" }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, results });
}
