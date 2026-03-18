import { getServiceClient } from "../supabase/server";
import {
  encrypt,
  decrypt,
  serializeEncrypted,
  deserializeEncrypted,
} from "../security/encryption";

export type SessionType = "offline" | "online";

export interface StoredSession {
  id: string;
  shopId: string;
  sessionType: SessionType;
  userId: string | null;
  shopDomain: string;
  accessToken: string;
  scopes: string;
  expiresAt: string | null;
}

function isLikelyMyShopifyDomain(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value.trim());
}

/**
 * Upsert a Shopify session (online or offline) into shop_sessions.
 * Access token is encrypted at rest with key version tracking.
 *
 * For offline sessions (user_id IS NULL), PostgreSQL's unique constraint
 * treats NULLs as distinct, so onConflict won't match. We use a
 * delete-then-insert pattern for offline sessions to avoid duplicates.
 */
export async function storeSession(session: {
  shopInternalId: string;
  shopDomain: string;
  sessionType: SessionType;
  userId?: string | null;
  accessToken: string;
  scopes: string;
  expiresAt?: string | null;
}): Promise<void> {
  const db = getServiceClient();
  const encrypted = encrypt(session.accessToken);
  const tokenStr = serializeEncrypted(encrypted);

  const row = {
    shop_id: session.shopInternalId,
    session_type: session.sessionType,
    user_id: session.userId ?? null,
    shop_domain: session.shopDomain,
    access_token_encrypted: tokenStr,
    key_version: encrypted.keyVersion,
    scopes: session.scopes,
    expires_at: session.expiresAt ?? null,
  };

  if (session.sessionType === "offline") {
    await db
      .from("shop_sessions")
      .delete()
      .eq("shop_id", session.shopInternalId)
      .eq("session_type", "offline")
      .is("user_id", null);

    const { error } = await db.from("shop_sessions").insert(row);
    if (error) throw new Error(`Failed to store session: ${error.message}`);
  } else {
    const { error } = await db.from("shop_sessions").upsert(row, {
      onConflict: "shop_id,session_type,user_id",
    });
    if (error) throw new Error(`Failed to store session: ${error.message}`);
  }
}

/**
 * Load a session for the given shop. Defaults to offline.
 * For Epic 5 (save evidence), pass sessionType='online'.
 */
export async function loadSession(
  shopInternalId: string,
  sessionType: SessionType = "offline"
): Promise<StoredSession | null> {
  const db = getServiceClient();

  let query = db
    .from("shop_sessions")
    .select("*")
    .eq("shop_id", shopInternalId)
    .eq("session_type", sessionType);

  if (sessionType === "offline") {
    query = query.is("user_id", null);
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (error || !data) return null;

  const encrypted = deserializeEncrypted(data.access_token_encrypted);
  const accessToken = decrypt(encrypted);

  let shopDomain = (data.shop_domain ?? "").trim();
  if (!isLikelyMyShopifyDomain(shopDomain)) {
    // Backward-compatibility for old rows missing/invalid shop_domain.
    const { data: shopRow } = await db
      .from("shops")
      .select("shop_domain")
      .eq("id", data.shop_id)
      .maybeSingle();
    const fallbackDomain = (shopRow?.shop_domain ?? "").trim();
    if (isLikelyMyShopifyDomain(fallbackDomain)) {
      shopDomain = fallbackDomain;
    }
  }

  return {
    id: data.id,
    shopId: data.shop_id,
    sessionType: data.session_type,
    userId: data.user_id,
    shopDomain,
    accessToken,
    scopes: data.scopes,
    expiresAt: data.expires_at,
  };
}

export async function deleteShopSessions(shopInternalId: string): Promise<void> {
  const db = getServiceClient();
  const { error } = await db
    .from("shop_sessions")
    .delete()
    .eq("shop_id", shopInternalId);
  if (error) throw new Error(`Failed to delete sessions: ${error.message}`);
}
