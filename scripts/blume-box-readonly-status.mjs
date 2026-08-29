import { createRequire } from "node:module";
import { createDecipheriv } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(`${projectRoot}/package.json`);
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: `${projectRoot}/.env.local`, quiet: true });

const shopDomain = process.argv[2] || process.env.REPORT_SHOP_DOMAIN;
if (!shopDomain) {
  throw new Error(
    "Shop domain required. Pass it as the first argument or set REPORT_SHOP_DOMAIN.",
  );
}

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function decryptToken(raw) {
  if (!raw?.startsWith("v")) return raw;
  const [versionPart, ivHex, tagHex, ciphertextHex] = raw.split(":");
  const version = Number(versionPart.slice(1));
  const keyHex = process.env[`TOKEN_ENCRYPTION_KEY_V${version}`] ||
    (version === 1 ? process.env.TOKEN_ENCRYPTION_KEY : null);
  if (!keyHex) throw new Error(`Missing token encryption key V${version}`);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keyHex, "hex"),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

function countBy(rows, field) {
  return rows.reduce((acc, row) => {
    const key = row[field] ?? "null";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function median(sortedValues) {
  if (sortedValues.length === 0) return 0;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
}

async function rows(table, select, shopId, since) {
  let query = db.from(table).select(select).eq("shop_id", shopId);
  if (since) query = query.gte("created_at", since);
  const { data, error } = await query.order("created_at", { ascending: true });
  return error ? { error: error.message, data: [] } : { data };
}

const since = "2026-07-28T00:00:00Z";
const { data: shop, error: shopError } = await db
  .from("shops")
  .select("id,shop_domain,currency_code,plan,created_at,installed_at,uninstalled_at,last_reconciled_at,first_win_at")
  .eq("shop_domain", shopDomain)
  .is("uninstalled_at", null)
  .maybeSingle();
if (shopError) throw shopError;
if (!shop) throw new Error(`Active shop not found: ${shopDomain}`);

const { data: disputes, error: disputeError } = await db
  .from("disputes")
  .select("id,dispute_gid,status,normalized_status,submission_state,reason,amount,currency_code,initiated_at,due_at,created_at,last_synced_at,submitted_at,closed_at,final_outcome,outcome_amount_recovered,outcome_amount_lost")
  .eq("shop_id", shop.id)
  .gte("initiated_at", since)
  .order("initiated_at", { ascending: true });
if (disputeError) throw disputeError;

const { data: allDisputes, error: allDisputesError } = await db
  .from("disputes")
  .select("id,dispute_gid,status,normalized_status,submission_state,reason,amount,currency_code,initiated_at,created_at,submitted_at,closed_at,final_outcome,outcome_amount_recovered,outcome_amount_lost")
  .eq("shop_id", shop.id)
  .order("initiated_at", { ascending: true });
if (allDisputesError) throw allDisputesError;

const isSynthetic = (gid = "") => /(?:test-|seed-|dd-seed|e2e|fixture|mock)/i.test(gid);
const productionDisputes = allDisputes.filter((row) => !isSynthetic(row.dispute_gid));
const syntheticDisputes = allDisputes.filter((row) => isSynthetic(row.dispute_gid));
const numericAmounts = productionDisputes.map((row) => Number(row.amount) || 0).sort((a, b) => a - b);
const productionAmount = numericAmounts.reduce((total, amount) => total + amount, 0);
const productionMedianAmount = median(numericAmounts);
const productionSpanDays = productionDisputes.length > 1
  ? (new Date(productionDisputes.at(-1).initiated_at) - new Date(productionDisputes[0].initiated_at)) / 86400000 + 1
  : 0;

const [packs, packages, submissions, audit, events, jobs, webhooks] = await Promise.all([
  rows("evidence_packs", "id,dispute_id,status,submission_readiness,package_type,created_at,updated_at,last_saved_to_shopify_at,saved_to_shopify_at,failure_code,failure_reason", shop.id, since),
  rows("defence_packages", "id,dispute_id,status,created_at,updated_at,submitted_at", shop.id, since),
  rows("submission_logs", "id,dispute_id,channel,final_outcome,created_at,submitted_at", shop.id, since),
  rows("audit_events", "id,dispute_id,event_type,actor_type,created_at,event_payload", shop.id, since),
  rows("dispute_events", "id,dispute_id,event_type,source,created_at,event_payload", shop.id, since),
  rows("jobs", "id,type,status,created_at,updated_at,error", shop.id, since),
  rows("webhook_events", "id,topic,outcome,created_at,processed_at,error", shop.id, since),
]);

const configReads = await Promise.all([
  db.from("shop_setup").select("*").eq("shop_id", shop.id).maybeSingle(),
  db.from("shop_settings").select("*").eq("shop_id", shop.id).maybeSingle(),
  db.from("rules").select("id,enabled,match,action,priority,created_at,updated_at").eq("shop_id", shop.id).order("priority", { ascending: false }),
  db.from("integrations").select("type,status,created_at,updated_at").eq("shop_id", shop.id),
  db.from("policy_snapshots").select("policy_type,captured_at").eq("shop_id", shop.id),
  db.from("pack_templates").select("id,name,status,created_at,updated_at").eq("shop_id", shop.id),
  db.from("pack_usage_events").select("event_type,packs,created_at").eq("shop_id", shop.id),
  db.from("app_events").select("name,created_at").eq("shop_id", shop.id).gte("created_at", since),
  db.from("shop_daily_metrics").select("date,order_count,dispute_count,chargeback_count,inquiry_count,last_synced_at").eq("shop_id", shop.id).gte("date", "2026-07-28"),
]);

const [setupRead, settingsRead, rulesRead, integrationsRead, policiesRead, templatesRead, usageRead, appEventsRead, dailyRead] = configReads;
const sum = (items, field) => (items || []).reduce((total, item) => total + (Number(item[field]) || 0), 0);

const { data: session, error: sessionError } = await db
  .from("shop_sessions")
  .select("access_token_encrypted,shop_domain")
  .eq("shop_id", shop.id)
  .eq("session_type", "offline")
  .is("user_id", null)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (sessionError) throw sessionError;

let shopify = { available: false, errors: ["No offline session"] };
if (session) {
  const accessToken = decryptToken(session.access_token_encrypted);
  const query = `query($first:Int!){disputes(first:$first){edges{node{id type status reasonDetails{reason} amount{amount currencyCode} initiatedAt evidenceDueBy evidenceSentOn finalizedOn}}}}`;
  const response = await fetch(
    `https://${shop.shop_domain}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-01"}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables: { first: 100 } }),
    },
  );
  const payload = await response.json();
  const shopifyErrors = Array.isArray(payload.errors)
    ? payload.errors.map((error) => error.message)
    : payload.errors
      ? [typeof payload.errors === "string" ? payload.errors : JSON.stringify(payload.errors)]
      : [];
  shopify = {
    available: response.ok && !payload.errors,
    http_status: response.status,
    errors: shopifyErrors,
    disputes: (payload.data?.disputes?.edges || []).map(({ node }) => node),
  };
}

const safeAudit = audit.data.map((row) => ({
  created_at: row.created_at,
  dispute_id: row.dispute_id,
  event_type: row.event_type,
  actor_type: row.actor_type,
  keys: row.event_payload && typeof row.event_payload === "object"
    ? Object.keys(row.event_payload)
    : [],
}));

console.log(JSON.stringify({
  snapshot_at: new Date().toISOString(),
  shop,
  local: {
    disputes,
    dispute_quality: {
      all_count: allDisputes.length,
      production_count: productionDisputes.length,
      synthetic_count: syntheticDisputes.length,
      production_by_outcome: countBy(productionDisputes, "final_outcome"),
      production_by_currency: countBy(productionDisputes, "currency_code"),
      production_by_reason: countBy(productionDisputes, "reason"),
      production_by_status: countBy(productionDisputes, "normalized_status"),
      production_by_submission_state: countBy(productionDisputes, "submission_state"),
      production_amount: productionAmount,
      production_average_amount: productionDisputes.length ? productionAmount / productionDisputes.length : 0,
      production_median_amount: productionMedianAmount,
      production_span_days: productionSpanDays,
      annualized_case_run_rate: productionSpanDays ? productionDisputes.length / productionSpanDays * 365 : 0,
      annualized_disputed_value_run_rate: productionSpanDays ? productionAmount / productionSpanDays * 365 : 0,
      production_first_initiated_at: productionDisputes[0]?.initiated_at || null,
      production_last_initiated_at: productionDisputes.at(-1)?.initiated_at || null,
      synthetic_gid_samples: syntheticDisputes.slice(0, 5).map((row) => row.dispute_gid),
    },
    evidence_packs: packs,
    defence_packages: packages,
    submission_logs: submissions,
    audit_event_counts: countBy(audit.data, "event_type"),
    audit_events: safeAudit,
    dispute_event_counts: countBy(events.data, "event_type"),
    job_counts: countBy(jobs.data, "status"),
    webhook_counts: countBy(webhooks.data, "outcome"),
    configuration: {
      setup: setupRead.error ? { error: setupRead.error.message } : setupRead.data,
      settings: settingsRead.error ? { error: settingsRead.error.message } : settingsRead.data,
      rules: rulesRead.error ? { error: rulesRead.error.message } : {
        count: rulesRead.data.length,
        enabled: rulesRead.data.filter((rule) => rule.enabled).length,
        rows: rulesRead.data,
      },
      integrations: integrationsRead.error ? { error: integrationsRead.error.message } : integrationsRead.data,
      policy_snapshots: policiesRead.error ? { error: policiesRead.error.message } : {
        count: policiesRead.data.length,
        by_type: countBy(policiesRead.data, "policy_type"),
        latest: policiesRead.data.map((row) => row.captured_at).sort().at(-1) || null,
      },
      pack_templates: templatesRead.error ? { error: templatesRead.error.message } : {
        count: templatesRead.data.length,
        by_status: countBy(templatesRead.data, "status"),
      },
      pack_usage: usageRead.error ? { error: usageRead.error.message } : {
        count: usageRead.data.length,
        packs: sum(usageRead.data, "packs"),
        by_event: countBy(usageRead.data, "event_type"),
      },
      app_events: appEventsRead.error ? { error: appEventsRead.error.message } : countBy(appEventsRead.data, "name"),
      daily_metrics: dailyRead.error ? { error: dailyRead.error.message } : {
        days: dailyRead.data.length,
        orders: sum(dailyRead.data, "order_count"),
        disputes: sum(dailyRead.data, "dispute_count"),
        chargebacks: sum(dailyRead.data, "chargeback_count"),
        inquiries: sum(dailyRead.data, "inquiry_count"),
        latest_sync: dailyRead.data.map((row) => row.last_synced_at).sort().at(-1) || null,
      },
    },
    errors: [packs, packages, submissions, audit, events, jobs, webhooks]
      .filter((item) => item.error)
      .map((item) => item.error),
  },
  shopify,
}, null, 2));
