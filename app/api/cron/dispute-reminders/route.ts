import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { sendDueReminder } from "@/lib/email/sendDueReminder";

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/dispute-reminders
 *
 * Called by Vercel Cron once daily (9 AM UTC). For each dispute due within 48h
 * that hasn't had a reminder sent yet, sends a due-date reminder email
 * to the merchant's team email (if the beforeDue preference is enabled).
 */
export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");

  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceClient();

  // Disputes due within 48h that haven't been reminded yet.
  const cutoff = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: disputes, error } = await sb
    .from("disputes")
    .select("id, shop_id, reason, phase, amount, currency_code, due_at, order_name")
    .gt("due_at", new Date().toISOString())
    .lte("due_at", cutoff)
    .is("reminder_sent_at", null)
    .in("status", ["needs_response", "open"]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!disputes?.length) {
    return NextResponse.json({ sent: 0, skipped: 0 });
  }

  // Group by shop so we load setup once per shop.
  const byShop = new Map<string, typeof disputes>();
  for (const d of disputes) {
    const list = byShop.get(d.shop_id) ?? [];
    list.push(d);
    byShop.set(d.shop_id, list);
  }

  let sent = 0;
  let skipped = 0;

  for (const [shopId, shopDisputes] of byShop) {
    // Load setup + shop data once per shop.
    const [{ data: setup }, { data: shop }] = await Promise.all([
      sb.from("shop_setup").select("steps").eq("shop_id", shopId).single(),
      sb.from("shops").select("shop_domain").eq("id", shopId).single(),
    ]);

    const steps = setup?.steps as Record<
      string,
      { payload?: Record<string, unknown> }
    > | null;

    const teamPayload = steps?.team?.payload;
    const notifications = teamPayload?.notifications as {
      beforeDue?: boolean;
    } | null;
    if (notifications?.beforeDue === false) {
      skipped += shopDisputes.length;
      continue;
    }

    const teamEmail = teamPayload?.teamEmail as string | undefined;
    if (!teamEmail) {
      skipped += shopDisputes.length;
      continue;
    }

    const storeLocale =
      (steps?.store_profile?.payload?.storeLocale as string | undefined) ?? "en";
    const shopName = shop?.shop_domain ?? "your store";

    // Get latest pack status per dispute in one query.
    const disputeIds = shopDisputes.map((d) => d.id);
    const { data: packRows } = await sb
      .from("evidence_packs")
      .select("dispute_id, status, updated_at")
      .in("dispute_id", disputeIds)
      .order("updated_at", { ascending: false });
    const packByDispute = new Map<string, string>();
    for (const p of (packRows ?? []) as Array<{
      dispute_id: string | null;
      status: string | null;
    }>) {
      if (p.dispute_id && !packByDispute.has(p.dispute_id)) {
        packByDispute.set(p.dispute_id, p.status ?? "");
      }
    }

    for (const d of shopDisputes) {
      const ok = await sendDueReminder({
        to: teamEmail,
        locale: storeLocale,
        shopName,
        shopDomain: shop?.shop_domain ?? null,
        disputeId: d.id,
        reason: d.reason,
        phase: d.phase,
        amount: d.amount,
        currencyCode: d.currency_code,
        dueAt: d.due_at!,
        orderName: d.order_name,
        packStatus: packByDispute.get(d.id) ?? null,
      });

      if (ok) {
        await sb
          .from("disputes")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", d.id);
        sent++;
      } else {
        skipped++;
      }
    }
  }

  return NextResponse.json({ sent, skipped });
}
