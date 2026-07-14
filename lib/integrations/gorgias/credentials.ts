/**
 * Shared Gorgias connection loader.
 *
 * Single decrypt path for every Gorgias consumer (evidence collector,
 * enrichment job, API routes) so credential handling has one auditable
 * surface. Secrets are AES-256-GCM encrypted at rest (key-versioned via
 * lib/security/encryption) and must NEVER be logged or serialized to the
 * browser — callers receive the decrypted bundle in memory only.
 *
 * Evidence mode (integrations.meta.evidence_mode) rides along because the
 * collector's inclusion behavior is keyed on it:
 *   'merchant_review_required'  only merchant-approved messages may reach
 *                               a pack — never silently fall back
 *   'legacy_auto_include'       retired at the 2026-07-14 cutover
 *                               (migration 20260714200000). The value can
 *                               still appear on the type for historical
 *                               reads, but no code path honors it and a
 *                               MISSING value now fail-safes to
 *                               merchant_review_required.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import type { GorgiasCredentials } from "./client";

export type GorgiasEvidenceMode =
  | "legacy_auto_include"
  | "merchant_review_required";

export interface GorgiasConnection {
  integrationId: string;
  credentials: GorgiasCredentials;
  evidenceMode: GorgiasEvidenceMode;
}

export function readEvidenceMode(meta: unknown): GorgiasEvidenceMode {
  const mode =
    meta && typeof meta === "object"
      ? (meta as Record<string, unknown>).evidence_mode
      : null;
  // Post-cutover fail-safe: anything that isn't the retired legacy
  // literal — including a missing value — is merchant-review mode.
  return mode === "legacy_auto_include"
    ? "legacy_auto_include"
    : "merchant_review_required";
}

/**
 * Loads the connected Gorgias integration + decrypted credentials for a
 * shop. Returns null when not connected or the secret is missing/invalid
 * (callers treat that as "no Gorgias", never as an error).
 */
export async function loadGorgiasConnection(
  shopId: string,
): Promise<GorgiasConnection | null> {
  const sb = getServiceClient();
  const { data: integration } = await sb
    .from("integrations")
    .select("id, status, meta")
    .eq("shop_id", shopId)
    .eq("type", "gorgias")
    .maybeSingle();

  if (!integration || integration.status !== "connected") return null;

  const { data: secret } = await sb
    .from("integration_secrets")
    .select("secret_enc")
    .eq("integration_id", integration.id)
    .maybeSingle();

  if (!secret?.secret_enc) return null;

  let parsed: Partial<GorgiasCredentials>;
  try {
    parsed = JSON.parse(
      decrypt(deserializeEncrypted(secret.secret_enc)),
    ) as Partial<GorgiasCredentials>;
  } catch {
    return null;
  }

  if (!parsed.subdomain || !parsed.email || !parsed.apiKey) return null;

  return {
    integrationId: integration.id as string,
    credentials: {
      subdomain: parsed.subdomain,
      email: parsed.email,
      apiKey: parsed.apiKey,
    },
    evidenceMode: readEvidenceMode(integration.meta),
  };
}

/** Credential-only view kept for the collector's existing deps seam. */
export async function loadGorgiasCredentials(
  shopId: string,
): Promise<GorgiasCredentials | null> {
  const conn = await loadGorgiasConnection(shopId);
  return conn?.credentials ?? null;
}
