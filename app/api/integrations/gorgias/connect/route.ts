import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  encrypt,
  serializeEncrypted,
} from "@/lib/security/encryption";
import { logSetupEvent } from "@/lib/setup/events";

export async function POST(req: NextRequest) {
  const shopId = req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const body = await req.json();
  const { subdomain, email, apiKey } = body;

  if (!subdomain || !email || !apiKey) {
    return NextResponse.json(
      { error: "subdomain, email, and apiKey are required" },
      { status: 400 }
    );
  }

  const sb = getServiceClient();

  // Test Gorgias connection
  let testOk = false;
  let testError: string | null = null;
  try {
    const base = `https://${subdomain}.gorgias.com`;
    const cred = Buffer.from(`${email}:${apiKey}`).toString("base64");
    const res = await fetch(`${base}/api/tickets?limit=1`, {
      headers: { Authorization: `Basic ${cred}` },
    });
    if (res.ok) {
      testOk = true;
    } else {
      testError = `Gorgias returned ${res.status}: ${res.statusText}`;
    }
  } catch (e: unknown) {
    testError = e instanceof Error ? e.message : "Connection failed";
  }

  const status = testOk ? "connected" : "needs_attention";

  // Upsert integration row
  const { data: integration, error: intErr } = await sb
    .from("integrations")
    .upsert(
      {
        shop_id: shopId,
        type: "gorgias",
        status,
        meta: {
          subdomain,
          email,
          ...(testError ? { last_error: testError } : {}),
          tested_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,type" }
    )
    .select("id")
    .single();

  if (intErr || !integration) {
    return NextResponse.json(
      { error: intErr?.message ?? "Failed to save integration" },
      { status: 500 }
    );
  }

  // Encrypt and store credentials
  const secretPayload = JSON.stringify({ subdomain, email, apiKey });
  const encrypted = encrypt(secretPayload);
  const secretEnc = serializeEncrypted(encrypted);

  await sb
    .from("integration_secrets")
    .upsert(
      {
        integration_id: integration.id,
        secret_enc: secretEnc,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "integration_id" }
    );

  const eventName = testOk ? "integration_connected" : "integration_failed";
  await logSetupEvent(shopId, eventName, {
    type: "gorgias",
    subdomain,
    ...(testError ? { error: testError } : {}),
  });

  return NextResponse.json({
    ok: testOk,
    status,
    error: testError,
    integrationId: integration.id,
  });
}
