import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { verifyUnsubToken } from "@/lib/marketing/playbook/leads";

export const runtime = "nodejs";

/**
 * GET /api/playbook/unsubscribe?token=<signed>
 *
 * Stateless one-click unsubscribe linked in every nurture email footer. The
 * token is an HMAC over the lead's email, so no lookup table is needed and the
 * link cannot be forged. Sets status='unsubscribed' (the cron skips those).
 * Always renders a friendly confirmation page (even for unknown emails) so we
 * never leak whether an address is on the list.
 */

function page(message: string): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unsubscribed · DisputeDesk</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fbf7ee;color:#0b1220;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;}
  .card{max-width:420px;text-align:center;}
  .mark{font-family:Georgia,serif;font-style:italic;font-size:40px;color:#2563eb;}
  h1{font-family:Georgia,serif;font-weight:600;font-size:24px;margin:8px 0 10px;}
  p{font-size:15px;line-height:1.6;color:#475569;margin:0 0 18px;}
  a{color:#1d4ed8;font-weight:600;text-decoration:none;}
</style></head>
<body><div class="card"><div class="mark">§</div><h1>${message}</h1>
<p>You won't receive any more Liability-Shift Playbook emails. The Playbook itself is always yours to keep.</p>
<a href="/">Back to DisputeDesk →</a></div></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const email = verifyUnsubToken(token);

  if (!email) {
    return page("This unsubscribe link is invalid.");
  }

  try {
    const sb = getServiceClient();
    const unsubscribedAt = new Date().toISOString();
    // This endpoint is the single unsubscribe surface for both inbound GTM
    // lead tables (the playbook nurture footer AND the Winnability Test result
    // email both link here). Mark the email unsubscribed in whichever it
    // appears — both updates are no-ops if the email isn't present.
    await Promise.all([
      sb
        .from("playbook_leads")
        .update({ status: "unsubscribed", unsubscribed_at: unsubscribedAt })
        .eq("email", email),
      sb
        .from("winnability_leads")
        .update({ status: "unsubscribed", unsubscribed_at: unsubscribedAt })
        .eq("email", email),
    ]);
  } catch (err) {
    console.error("[playbook/unsubscribe] db threw:", err);
    // Still show success — re-clicking is harmless and idempotent.
  }

  return page("You're unsubscribed.");
}
