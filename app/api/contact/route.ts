import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.CONTACT_FORM_TO ?? "support@disputedesk.com";
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";

/**
 * POST /api/contact
 * Body: { name, email, message }
 *
 * Sends a contact form email via Resend.
 * Basic honeypot + rate-limit via simple in-memory counter.
 */

const recentSubmissions = new Map<string, number>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const last = recentSubmissions.get(ip);
  if (last && now - last < 30_000) return true;
  recentSubmissions.set(ip, now);
  // Cleanup old entries
  if (recentSubmissions.size > 1000) {
    for (const [key, ts] of recentSubmissions) {
      if (now - ts > 60_000) recentSubmissions.delete(key);
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Please wait before sending another message." },
      { status: 429 }
    );
  }

  let body: {
    name?: string;
    email?: string;
    message?: string;
    _honey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot field — bots fill this, humans don't see it
  if (body._honey) {
    return NextResponse.json({ ok: true });
  }

  const name = body.name?.trim();
  const email = body.email?.trim();
  const message = body.message?.trim();

  if (!name || !email || !message) {
    return NextResponse.json(
      { error: "All fields are required." },
      { status: 400 }
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Invalid email address." },
      { status: 400 }
    );
  }

  if (message.length > 5000) {
    return NextResponse.json(
      { error: "Message too long." },
      { status: 400 }
    );
  }

  if (!RESEND_API_KEY) {
    console.error("[contact] RESEND_API_KEY not set");
    return NextResponse.json(
      { error: "Email service unavailable." },
      { status: 503 }
    );
  }

  const resend = new Resend(RESEND_API_KEY);

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: TO_EMAIL,
    replyTo: email,
    subject: `[Contact] ${name}`,
    text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
  });

  if (error) {
    console.error("[contact] Resend error:", error);
    return NextResponse.json(
      { error: "Failed to send message." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
