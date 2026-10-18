import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { sendDueReminder, type DueReminderFilingMode } from "@/lib/email/sendDueReminder";
import { cronEnvGate } from "@/lib/cron/envGate";
import { resurfaceHeldReviews } from "@/lib/disputes/resurfaceHeldReviews";
import { getShopSettings } from "@/lib/automation/settings";
import { deadlineAwaitsMerchantApproval } from "@/lib/automation/merchantApprovalGate";
import { REVIEW_STATES } from "@/lib/disputes/reviewState";
import { storeDisplayName } from "@/lib/shopify/storeDisplayName";

/**
 * GET /api/cron/dispute-reminders
 *
 * Called by Vercel Cron once daily (9 AM UTC). For each dispute due within 48h
 * that hasn't had a reminder sent yet, sends a due-date reminder email
 * to the merchant's team email (if the beforeDue preference is enabled).
 *
 * The email states what the deadline cron will do with the dispute, resolved
 * through the same approval gate it files through — so an auto-mode shop is
 * told there is nothing to do, and a review-mode shop is told nothing is filed
 * until it approves. Never "depends on your automation setting".
 */
export async function GET(req: NextRequest) {
  const gate = cronEnvGate(req);
  if (gate) return gate;

  const sb = getServiceClient();

  // First: resurface any "held for review" dispute near its deadline so
  // a stale hold can't silently ride to the deadline. Runs independently
  // of the reminder-email scan below (which filters on reminder_sent_at).
  const resurface = await resurfaceHeldReviews(sb);

  // Disputes due within 48h that haven't been reminded yet.
  // Exclude rows where the merchant has already saved/submitted evidence —
  // Shopify keeps `status` at `needs_response` until resolution, so we must
  // gate on `normalized_status` (which reflects merchant action).
  const cutoff = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const merchantActionableStatuses = [
    "new",
    "in_progress",
    "needs_review",
    "ready_to_submit",
    "action_needed",
  ];
  const { data: disputes, error } = await sb
    .from("disputes")
    .select("id, shop_id, reason, status, phase, amount, currency_code, due_at, order_name, review_state")
    .gt("due_at", new Date().toISOString())
    .lte("due_at", cutoff)
    .is("reminder_sent_at", null)
    .is("submitted_at", null)
    .is("evidence_saved_to_shopify_at", null)
    .in("status", ["needs_response", "open"])
    .or(
      `normalized_status.is.null,normalized_status.in.(${merchantActionableStatuses.join(",")})`,
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!disputes?.length) {
    return NextResponse.json({ sent: 0, skipped: 0, resurfaced: resurface.resurfaced });
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
    const [{ data: setup }, { data: shop }, shopSettings] = await Promise.all([
      sb.from("shop_setup").select("steps").eq("shop_id", shopId).single(),
      sb.from("shops").select("shop_domain, shop_name, primary_domain").eq("id", shopId).single(),
      getShopSettings(shopId),
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
    const shopName = storeDisplayName(shop) ?? "your store";

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
      const approval = await deadlineAwaitsMerchantApproval(d, shopSettings.auto_save_enabled);
      const filingMode: DueReminderFilingMode = approval.awaits
        ? "awaiting_approval"
        : d.review_state === REVIEW_STATES.APPROVED
          ? "approved"
          : "auto";
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
        filingMode,
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

  return NextResponse.json({ sent, skipped, resurfaced: resurface.resurfaced });
}
