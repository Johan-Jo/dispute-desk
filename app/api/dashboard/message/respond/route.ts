/**
 * POST /api/dashboard/message/respond
 *
 * The merchant answered a contact-asking message. Stores the reply on
 * the row and emails it to the ops address so a human can follow up.
 *
 * Body: { messageId: string, email?: string, phone?: string, note?: string }
 *
 * At least one of email/phone is required — the banner asks for
 * "email or phone", so either alone is a complete answer.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { sendAdminEmail } from "@/lib/email/adminEmail";

export const runtime = "nodejs";

/** Defensive caps — this text lands in an email body. */
const MAX_FIELD = 200;
const MAX_NOTE = 2000;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
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

export async function POST(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  let body: {
    messageId?: string;
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
    ["Email", email || "—"],
    ["Phone", phone || "—"],
    ["Note", note || "—"],
  ];

  // Awaited (not fire-and-forget): this email IS the point of the
  // feature. sendAdminEmail never throws, so a send failure still
  // returns ok — the reply is already persisted on the row either way.
  await sendAdminEmail({
    logTag: "merchant-message-response",
    subject: `${shopName} shared contact details (${shopDomain})`,
    html: `<h2>Merchant replied to your in-app message</h2><table cellpadding="6">${rows
      .map(
        ([k, v]) =>
          `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`,
      )
      .join("")}</table>`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
  });

  await sb.from("audit_events").insert({
    shop_id: shopId,
    actor_type: "merchant",
    event_type: "merchant_message_answered",
    event_payload: {
      message_id: messageId,
      has_email: !!email,
      has_phone: !!phone,
      has_note: !!note,
    },
  });

  return NextResponse.json({ ok: true });
}
