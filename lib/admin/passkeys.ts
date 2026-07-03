/**
 * Node-side data + config helpers for the custom-WebAuthn admin second factor.
 * All DB access uses the service-role client (admin_passkeys is service-role-only
 * RLS). Cookie signing lives in lib/admin/passkeyCookie.ts; ceremony verification
 * lives in the /api/admin/passkeys/* routes.
 */
import type { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";

export interface StoredPasskey {
  id: string;
  credentialId: string; // base64url
  publicKey: Uint8Array; // COSE public key
  counter: number;
  transports: string[] | null;
  friendlyName: string | null;
}

// ── bytea <-> hex (Postgres bytea over supabase-js needs `\x<hex>`) ─────────

function toPgHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return `\\x${hex}`;
}

/** Postgres returns bytea as a `\x...` hex string over the REST API. */
function fromPgHex(value: string): Uint8Array {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

// ── Relying-Party config (per environment) ─────────────────────────────────

export interface RpConfig {
  rpID: string;
  origin: string;
  rpName: string;
}

/**
 * Resolve the WebAuthn Relying Party for this request. Prefer explicit env
 * (ADMIN_WEBAUTHN_RP_ID / ADMIN_WEBAUTHN_ORIGIN — set per Vercel env), else
 * derive from the request host so local/preview deploys work without config.
 * The RP ID is the registrable domain; the origin is the full https:// URL the
 * admin UI is served from. A passkey registered under one RP won't work under
 * another (dev vs prod) — that's correct and expected.
 */
export function getRpConfig(req: NextRequest): RpConfig {
  const envRpId = process.env.ADMIN_WEBAUTHN_RP_ID?.trim();
  const envOrigin = process.env.ADMIN_WEBAUTHN_ORIGIN?.trim();

  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    req.nextUrl.host;
  const proto =
    req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");

  const rpID = envRpId || host.split(":")[0];
  const origin = envOrigin || `${proto}://${host}`;

  return { rpID, origin, rpName: "DisputeDesk Admin" };
}

// ── admin_passkeys queries ─────────────────────────────────────────────────

export async function listPasskeys(userId: string): Promise<StoredPasskey[]> {
  const db = getServiceClient();
  const { data } = await db
    .from("admin_passkeys")
    .select("id, credential_id, public_key, counter, transports, friendly_name")
    .eq("user_id", userId);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    credentialId: r.credential_id as string,
    publicKey: fromPgHex(r.public_key as string),
    counter: Number(r.counter ?? 0),
    transports: (r.transports as string[] | null) ?? null,
    friendlyName: (r.friendly_name as string | null) ?? null,
  }));
}

/** Look up a single credential by its base64url id (for the auth ceremony). */
export async function getPasskeyByCredentialId(
  credentialId: string,
): Promise<(StoredPasskey & { userId: string }) | null> {
  const db = getServiceClient();
  const { data } = await db
    .from("admin_passkeys")
    .select(
      "id, user_id, credential_id, public_key, counter, transports, friendly_name",
    )
    .eq("credential_id", credentialId)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id as string,
    userId: data.user_id as string,
    credentialId: data.credential_id as string,
    publicKey: fromPgHex(data.public_key as string),
    counter: Number(data.counter ?? 0),
    transports: (data.transports as string[] | null) ?? null,
    friendlyName: (data.friendly_name as string | null) ?? null,
  };
}

export async function savePasskey(input: {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[] | null;
  friendlyName: string | null;
}): Promise<void> {
  const db = getServiceClient();
  const { error } = await db.from("admin_passkeys").insert({
    user_id: input.userId,
    credential_id: input.credentialId,
    public_key: toPgHex(input.publicKey),
    counter: input.counter,
    transports: input.transports,
    friendly_name: input.friendlyName,
  });
  if (error) throw new Error(`Failed to store passkey: ${error.message}`);
}

/** Bump the signature counter + last_used_at after a successful assertion. */
export async function updatePasskeyCounter(
  credentialId: string,
  counter: number,
): Promise<void> {
  const db = getServiceClient();
  await db
    .from("admin_passkeys")
    .update({ counter, last_used_at: new Date().toISOString() })
    .eq("credential_id", credentialId);
}
