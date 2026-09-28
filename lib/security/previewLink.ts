/**
 * Signed links for opening a defence-package PDF in a new browser tab.
 *
 * WHY. The embedded app's session cookies are set `sameSite=none; partitioned`
 * so they work inside Shopify Admin's iframe. "View PDF" opens the preview in
 * a NEW top-level tab — a different cookie partition — so the tab carried no
 * session and middleware answered 401 SESSION_REQUIRED (blume-box #360980,
 * 2026-09-24). The `?shop_id=` query parameter is not authentication.
 *
 * HOW. The workspace API (itself session-authenticated) mints a token bound to
 * ONE package and ONE shop, valid for an hour. The preview route accepts the
 * token in place of a session and checks both ids against the row it serves.
 * HMAC-SHA256 with the server-only app secret; constant-time comparison.
 * Nothing else is authorised by it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_SECONDS = 60 * 60;

function secret(): string | null {
  const s = process.env.SHOPIFY_API_SECRET;
  return s && s.length >= 16 ? s : null;
}

function sign(packageId: string, shopId: string, exp: number, key: string): string {
  return createHmac("sha256", key).update(`defence-preview:${packageId}:${shopId}:${exp}`).digest("hex");
}

/** `${exp}.${sig}`, or null when no signing secret is configured. */
export function signPreviewToken(
  packageId: string,
  shopId: string,
  opts: { ttlSeconds?: number; now?: number } = {},
): string | null {
  const key = secret();
  if (!key) return null;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const exp = now + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  return `${exp}.${sign(packageId, shopId, exp, key)}`;
}

export function verifyPreviewToken(
  token: string | null | undefined,
  packageId: string,
  shopId: string,
  opts: { now?: number } = {},
): boolean {
  const key = secret();
  if (!key || !token) return false;
  const m = token.match(/^(\d{9,12})\.([0-9a-f]{64})$/);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp < Math.floor((opts.now ?? Date.now()) / 1000)) return false;
  const expected = Buffer.from(sign(packageId, shopId, exp, key), "hex");
  const given = Buffer.from(m[2], "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Preview path + query for a package row, token included when one exists. */
export function previewPath(packageId: string, shopId: string, token: string | null): string {
  const q = new URLSearchParams({ shop_id: shopId });
  if (token) q.set("t", token);
  return `/api/defence-packages/${packageId}/preview?${q.toString()}`;
}
