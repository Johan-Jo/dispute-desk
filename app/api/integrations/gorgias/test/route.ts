import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import {
  decrypt,
  deserializeEncrypted,
} from "@/lib/security/encryption";
import { logSetupEvent } from "@/lib/setup/events";

export async function POST(req: NextRequest) {
  const shopId = req.headers.get("x-shop-id");
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: integration } = await sb
    .from("integrations")
    .select("id, meta")
    .eq("shop_id", shopId)
    .eq("type", "gorgias")
    .single();

  if (!integration) {
    return NextResponse.json(
      { error: "Gorgias integration not found" },
      { status: 404 }
    );
  }

  const { data: secret } = await sb
    .from("integration_secrets")
    .select("secret_enc")
    .eq("integration_id", integration.id)
    .single();

  if (!secret) {
    return NextResponse.json(
      { error: "Credentials not found" },
      { status: 404 }
    );
  }

  const payload = deserializeEncrypted(secret.secret_enc);
  const decrypted = JSON.parse(decrypt(payload)) as {
    subdomain: string;
    email: string;
    apiKey: string;
  };

  let testOk = false;
  let testError: string | null = null;
  try {
    const base = `https://${decrypted.subdomain}.gorgias.com`;
    const cred = Buffer.from(`${decrypted.email}:${decrypted.apiKey}`).toString("base64");
    const res = await fetch(`${base}/api/tickets?limit=1`, {
      headers: { Authorization: `Basic ${cred}` },
    });
    testOk = res.ok;
    if (!res.ok) {
      testError = `Gorgias returned ${res.status}: ${res.statusText}`;
    }
  } catch (e: unknown) {
    testError = e instanceof Error ? e.message : "Connection failed";
  }

  const status = testOk ? "connected" : "needs_attention";
  const meta = (integration.meta ?? {}) as Record<string, unknown>;

  await sb
    .from("integrations")
    .update({
      status,
      meta: {
        ...meta,
        tested_at: new Date().toISOString(),
        ...(testError ? { last_error: testError } : { last_error: null }),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", integration.id);

  await logSetupEvent(shopId, testOk ? "integration_connected" : "integration_failed", {
    type: "gorgias",
    retest: true,
    ...(testError ? { error: testError } : {}),
  });

  return NextResponse.json({ ok: testOk, status, error: testError });
}
