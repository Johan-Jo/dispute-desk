/**
 * DB-backed short codes for bank-facing evidence URLs.
 *
 * The bank reviewer sees `https://disputedesk.app/e/Q7K2HXRJ9P` instead
 * of the prior 200+ character HMAC-signed token. The route handler at
 * `app/e/[token]/route.ts` resolves the code via `evidence_short_links`
 * to a `(kind, entity_id, pack_id)` triple, then streams the file.
 *
 * Alphabet is Crockford Base32 (no I/L/O/U) so a code can be transcribed
 * by a human without ambiguity. 10 characters → 50 bits of entropy.
 */
import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicBaseUrl } from "@/lib/resources/url";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const SHORT_CODE_LENGTH = 10;
export const SHORT_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

export type ShortLinkKind = "item" | "pdf";

export interface CreateShortLinkInput {
  kind: ShortLinkKind;
  entityId: string;
  packId: string;
  shopId: string;
  disputeId: string | null;
  expiresAt: Date;
}

export interface ResolvedShortLink {
  kind: ShortLinkKind;
  entityId: string;
  packId: string;
}

export function generateShortCode(length: number = SHORT_CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

export function buildShortAttachmentUrl(code: string): string {
  const base = getPublicBaseUrl().replace(/\/$/, "");
  return `${base}/e/${code}`;
}

/**
 * Insert a short-link row, retrying on the (vanishingly unlikely)
 * unique-violation. Returns the short code (NOT the full URL) so
 * callers can build the URL with `buildShortAttachmentUrl`.
 */
export async function createShortLink(
  sb: SupabaseClient,
  input: CreateShortLinkInput,
): Promise<string> {
  const row = {
    kind: input.kind,
    entity_id: input.entityId,
    pack_id: input.packId,
    shop_id: input.shopId,
    dispute_id: input.disputeId,
    expires_at: input.expiresAt.toISOString(),
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateShortCode();
    const { error } = await sb
      .from("evidence_short_links")
      .insert({ ...row, short_code: code });

    if (!error) return code;

    // Postgres unique violation is code 23505 (PostgREST surfaces it on .code)
    const isCollision =
      typeof (error as { code?: string }).code === "string" &&
      (error as { code?: string }).code === "23505";

    if (!isCollision) {
      throw new Error(
        `createShortLink failed: ${error.message ?? "unknown error"}`,
      );
    }
  }
  throw new Error(
    "createShortLink: could not allocate a unique short code after 5 attempts",
  );
}

/**
 * Look up a short code. Returns null on missing / expired / revoked
 * (callers treat null as "deny" and 404). Best-effort updates
 * `last_accessed_at` for audit but never blocks the response.
 */
export async function resolveShortLink(
  sb: SupabaseClient,
  code: string,
): Promise<ResolvedShortLink | null> {
  if (!SHORT_CODE_RE.test(code)) return null;

  const { data, error } = await sb
    .from("evidence_short_links")
    .select("kind, entity_id, pack_id, expires_at, revoked_at")
    .eq("short_code", code)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  void sb
    .from("evidence_short_links")
    .update({ last_accessed_at: new Date().toISOString() })
    .eq("short_code", code)
    .then(
      () => undefined,
      () => undefined,
    );

  return {
    kind: data.kind as ShortLinkKind,
    entityId: data.entity_id as string,
    packId: data.pack_id as string,
  };
}
