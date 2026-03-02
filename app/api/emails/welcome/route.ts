import { NextResponse } from "next/server";
import { z } from "zod";
import { sendWelcomeEmail } from "@/lib/email/sendWelcome";

const BodySchema = z.object({
  email: z.string().email(),
  fullName: z.string().optional(),
});

/**
 * POST /api/emails/welcome
 * Sends the welcome email to a newly registered user.
 * Called from sign-up page (client) or from Shopify OAuth callback (server).
 */
export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    body = BodySchema.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "Invalid body: email (required), fullName (optional)" },
      { status: 400 }
    );
  }

  const idempotencyKey = `welcome/${body.email}`;
  const result = await sendWelcomeEmail({
    to: body.email,
    fullName: body.fullName,
    idempotencyKey,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
