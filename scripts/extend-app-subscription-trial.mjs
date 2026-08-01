/**
 * Extend the trial of an ACTIVE app subscription (ops one-off).
 *
 * Usage:
 *   node scripts/extend-app-subscription-trial.mjs <shop-domain> <subscription-gid> <days>
 *
 * Env file defaults to .env.local; override with DOTENV_PATH (e.g. a pulled
 * prod env when running against production — delete the pulled file after).
 *
 * Calls appSubscriptionTrialExtend and prints the resulting subscription.
 * DB sync (plan_entitlements.trial_ends_at + trial credit expiry) is done
 * separately — this script only touches Shopify.
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: process.env.DOTENV_PATH ?? join(process.cwd(), ".env.local") });

const [shopDomain, subscriptionGid, daysArg] = process.argv.slice(2);
const days = Number(daysArg);
if (!shopDomain || !subscriptionGid?.startsWith("gid://shopify/AppSubscription/") || !Number.isInteger(days) || days <= 0) {
  console.error("Usage: node scripts/extend-app-subscription-trial.mjs <shop-domain> <subscription-gid> <days>");
  process.exit(1);
}

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function deserialize(raw) {
  const [ver, iv, tag, ct] = raw.split(":");
  return {
    keyVersion: parseInt(ver.slice(1), 10),
    iv: Buffer.from(iv, "hex"),
    tag: Buffer.from(tag, "hex"),
    ciphertext: Buffer.from(ct, "hex"),
  };
}
function decrypt(payload) {
  const envName = `TOKEN_ENCRYPTION_KEY_V${payload.keyVersion}`;
  let hex = process.env[envName];
  if (!hex && payload.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

const { data: sess, error } = await sb
  .from("shop_sessions")
  .select("shop_domain, access_token_encrypted")
  .eq("shop_domain", shopDomain)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (error || !sess) {
  console.error("No offline session for", shopDomain, error ?? "");
  process.exit(1);
}
const token = decrypt(deserialize(sess.access_token_encrypted));

const MUTATION = `
  mutation TrialExtend($id: ID!, $days: Int!) {
    appSubscriptionTrialExtend(id: $id, days: $days) {
      appSubscription { id status trialDays currentPeriodEnd }
      userErrors { field message }
    }
  }
`;

const res = await fetch(`https://${shopDomain}/admin/api/2026-01/graphql.json`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
  body: JSON.stringify({ query: MUTATION, variables: { id: subscriptionGid, days } }),
});
const json = await res.json();
if (json.errors) {
  console.error("GraphQL errors:", JSON.stringify(json.errors, null, 2));
  process.exit(1);
}
const payload = json.data?.appSubscriptionTrialExtend;
if (payload?.userErrors?.length) {
  console.error("userErrors:", JSON.stringify(payload.userErrors, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(payload?.appSubscription, null, 2));
