/**
 * POST /api/dashboard/message/respond
 *
 * The merchant answered a contact-asking message. Stores the reply on
 * the row and emails it to the ops address so a human can follow up.
 *
 * Body: { messageId: string, name?: string, email?: string, phone?: string, note?: string }
 *
 * At least one of email/phone is required — the banner asks for
 * "email or phone", so either alone is a complete answer.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { Resend } from "resend";
import { DEFAULT_FROM_EMAIL } from "@/lib/email/addresses";

export const runtime = "nodejs";

/** Defensive caps — this text lands in an email body. */
const MAX_FIELD = 200;
const MAX_NOTE = 2000;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

/**
 * Escape before interpolating into the HTML email. Merchant-supplied
 * text is untrusted; without this a submitted tag would be live markup
 * in the ops inbox.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Send the ops notification and report whether it was accepted.
 *
 * Deliberately not `sendAdminEmail`: that helper returns void and
 * swallows every failure, which is right for background drift alerts
 * but wrong here — a merchant reply that never reaches ops is the one
 * failure this feature cannot afford to hide.
 */
async function sendResponseNotification(msg: {
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ADMIN_NOTIFY_EMAIL ?? "oi@johan.com.br";
  if (!apiKey) {
    console.warn("[email:merchant-message-response] RESEND_API_KEY not set");
    return { ok: false, error: "RESEND_API_KEY not set" };
  }
  try {
    const { data, error } = await new Resend(apiKey).emails.send({
      from: DEFAULT_FROM_EMAIL,
      to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    // The Resend SDK reports API-level rejections in `error` rather than
    // throwing, so this is the common failure path, not the rare one.
    if (error) {
      const detail = error.message ?? String(error);
      console.error("[email:merchant-message-response] rejected:", detail);
      return { ok: false, error: detail };
    }
    console.info(
      `[email:merchant-message-response] sent to ${to} (${data?.id ?? "?"})`,
    );
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[email:merchant-message-response] send failed:", detail);
    return { ok: false, error: detail };
  }
}

export async function POST(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  let body: {
    messageId?: string;
    name?: string;
    email?: string;
    phone?: string;
    note?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const messageId = (body.messageId ?? "").trim();
  const name = clean(body.name, MAX_FIELD);
  const email = clean(body.email, MAX_FIELD);
  const phone = clean(body.phone, MAX_FIELD);
  const note = clean(body.note, MAX_NOTE);

  if (!messageId) {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }
  if (!email && !phone) {
    return NextResponse.json(
      { error: "email or phone required" },
      { status: 400 },
    );
  }
  // Loose on purpose: a merchant typing an unusual-but-valid address
  // should never be turned away. Reject only what clearly isn't one.
  if (email && !email.includes("@")) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const sb = getServiceClient();

  // Scope the write by shop_id too — a uuid from another shop must not
  // be writable from this session.
  const nowIso = new Date().toISOString();
  const { data: updated, error } = await sb
    .from("merchant_messages")
    .update({
      responded_at: nowIso,
      response_name: name || null,
      response_email: email || null,
      response_phone: phone || null,
      response_note: note || null,
      updated_at: nowIso,
    })
    .eq("id", messageId)
    .eq("shop_id", shopId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const { data: shop } = await sb
    .from("shops")
    .select("shop_domain, shop_name")
    .eq("id", shopId)
    .single();

  const shopDomain = shop?.shop_domain ?? "(unknown)";
  const shopName = shop?.shop_name ?? "(unnamed)";

  const rows: Array<[string, string]> = [
    ["Shop", `${shopName} (${shopDomain})`],
    ["Name", name || "—"],
    ["Email", email || "—"],
    ["Phone", phone || "—"],
    ["Note", note || "—"],
  ];

  // This email IS the point of the feature, so unlike the other admin
  // alerts we need to know whether it actually went out. sendAdminEmail
  // returns void and swallows failures, which made a missing key (dev)
  // or a Resend rejection indistinguishable from success. Send directly
  // and record the outcome on the row so admin can see the difference.
  const notify = await sendResponseNotification({
    subject: `${shopName} shared contact details (${shopDomain})`,
    html: `<h2>Merchant replied to your in-app message</h2><table cellpadding="6">${rows
      .map(
        ([k, v]) =>
          `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`,
      )
      .join("")}</table>`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
  });

  await sb
    .from("merchant_messages")
    .update(
      notify.ok
        ? {
            response_notified_at: new Date().toISOString(),
            response_notify_error: null,
          }
        : { response_notify_error: notify.error },
    )
    .eq("id", messageId)
    .eq("shop_id", shopId);

  await sb.from("audit_events").insert({
    shop_id: shopId,
    actor_type: "merchant",
    event_type: "merchant_message_answered",
    event_payload: {
      message_id: messageId,
      has_name: !!name,
      has_email: !!email,
      has_phone: !!phone,
      has_note: !!note,
    },
  });

  return NextResponse.json({ ok: true });
}
