import { NextRequest, NextResponse } from "next/server";
import { executePublishQueueTick } from "@/lib/resources/cron/publishQueueTick";
import { checkShopifyReasonEnumDrift } from "@/lib/shopify/checkReasonEnumDrift";

const CRON_SECRET = process.env.CRON_SECRET;

async function runPublish(req: NextRequest) {
  const secret =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await executePublishQueueTick();

  // Piggyback the daily Shopify dispute-reason enum drift check onto
  // this cron because Vercel Hobby caps at 2 cron slots and both are
  // in use. Fire-and-forget: we do not await, we do not block the
  // cron response, and any failure is logged only. The helper itself
  // handles dedup so the admin only gets an email on new or changed
  // drift — clean runs are silent.
  void (async () => {
    try {
      const driftResult = await checkShopifyReasonEnumDrift();
      if ("drift" in driftResult && driftResult.drift === true) {
        console.log(
          "[cron/publish-content] reason-enum drift check:",
          JSON.stringify(driftResult),
        );
      }
    } catch (err) {
      console.error("[cron/publish-content] drift check failed:", err);
    }
  })();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({
    processed: result.processed,
    results: result.results,
  });
}

/** POST or GET (Vercel Cron uses GET with ?secret=) */
export async function POST(req: NextRequest) {
  return runPublish(req);
}

export async function GET(req: NextRequest) {
  return runPublish(req);
}
