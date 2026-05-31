/**
 * One-off backfill: send the admin install notification for a shop that
 * installed BEFORE `sendAdminInstallNotification` was wired into the OAuth
 * callback (2026-05-31, embedded App Store install `6mjjvm-tc`).
 *
 * Targets the PROD Supabase project using the NEW_* creds in
 * .env.production.local (the cutover env file). Owner email is read from
 * shop_setup (stored unencrypted), so no prod TOKEN_ENCRYPTION_KEY_V1 is
 * needed. RESEND_API_KEY comes from .env.local.
 *
 * Usage:
 *   node scripts/backfill-install-notification.mjs <shopInternalId>
 */

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

loadEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const shopInternalId = process.argv[2];
if (!shopInternalId) {
  console.error("Usage: node scripts/backfill-install-notification.mjs <shopInternalId>");
  process.exit(1);
}

// Read NEW_* prod Supabase creds from the cutover env file.
const prodEnv = readFileSync(resolve(process.cwd(), ".env.production.local"), "utf8");
function readProd(key) {
  const m = prodEnv.match(new RegExp("^" + key + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}
const SUPABASE_URL = readProd("NEW_SUPABASE_URL");
const SERVICE_ROLE_KEY = readProd("NEW_SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.EMAIL_FROM ?? "DisputeDesk <notifications@mail.disputedesk.app>";
const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL ?? "oi@johan.com.br";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEW_SUPABASE_URL / NEW_SUPABASE_SERVICE_ROLE_KEY in .env.production.local");
  process.exit(1);
}
if (!RESEND_API_KEY) {
  console.error("Missing RESEND_API_KEY in .env.local");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: shop, error } = await db
  .from("shops")
  .select("id, shop_domain, created_at")
  .eq("id", shopInternalId)
  .single();
if (error || !shop) {
  console.error(`Shop ${shopInternalId} not found in prod:`, error?.message);
  process.exit(1);
}

const { data: setup } = await db
  .from("shop_setup")
  .select("steps")
  .eq("shop_id", shopInternalId)
  .single();
const ownerEmail =
  setup?.steps?.team?.payload?.teamEmail?.trim() || undefined;

console.log(`[backfill] shop=${shop.shop_domain} email=${ownerEmail ?? "(none)"}`);

// Mirror sendAdminInstallNotification's body exactly.
const shopName = "—";
const email = ownerEmail || "—";
const source = "embedded (backfill)";
const timestamp = new Date(shop.created_at).toUTCString();
const subject = `New DisputeDesk install: ${shop.shop_domain}`;
const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;padding:32px 16px;">
  <p style="margin:0 0 8px;font-size:18px;font-weight:700;">New merchant installed DisputeDesk</p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;color:#374151;border-collapse:collapse;">
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Shop</td><td style="padding:4px 0;">${shop.shop_domain}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Store name</td><td style="padding:4px 0;">${shopName}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Owner email</td><td style="padding:4px 0;">${email}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Source</td><td style="padding:4px 0;">${source}</td></tr>
    <tr><td style="padding:4px 16px 4px 0;font-weight:600;">Time</td><td style="padding:4px 0;">${timestamp}</td></tr>
  </table>
</body>
</html>`;
const text =
  `New merchant installed DisputeDesk\n\n` +
  `Shop: ${shop.shop_domain}\nStore name: ${shopName}\nOwner email: ${email}\nSource: ${source}\nTime: ${timestamp}`;

const resend = new Resend(RESEND_API_KEY);
const res = await resend.emails.send({ from: FROM_EMAIL, to: ADMIN_EMAIL, subject, html, text });
console.log("[backfill] Resend response:", JSON.stringify(res));
console.log(`[backfill] Sent to ${ADMIN_EMAIL}. Check the inbox.`);
process.exit(0);
