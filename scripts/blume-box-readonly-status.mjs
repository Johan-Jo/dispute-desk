import { createRequire } from "node:module";
import { createDecipheriv } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  singleCurrencySummary,
  summarizeAmountsByCurrency,
} from "./lib/reporting-money.mjs";
import {
  isSyntheticDispute,
  reportingWindow,
} from "./lib/reporting-window.mjs";

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
const reportFrom = process.argv[3] || process.env.REPORT_FROM;
const reportTo = process.argv[4] || process.env.REPORT_TO;
if (!reportFrom || !reportTo) {
  throw new Error(
    "Report dates required. Pass YYYY-MM-DD start and end dates or set REPORT_FROM and REPORT_TO.",
  );
}
const window = reportingWindow(reportFrom, reportTo);

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

async function rows(table, select, shopId, windowStart, timestamp = "created_at") {
  let query = db.from(table).select(select).eq("shop_id", shopId);
  if (windowStart) query = query
    .gte(timestamp, windowStart)
    .lt(timestamp, window.to);
  const { data, error } = await query.order(timestamp, { ascending: true });
  return error ? { error: error.message, data: [] } : { data };
}

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
  .select("id,dispute_gid,status,normalized_status,submission_state,reason,amount,currency_code,initiated_at,due_at,created_at,last_synced_at,submitted_at,closed_at,final_outcome,outcome_amount_recovered,outcome_amount_lost,raw_snapshot")
  .eq("shop_id", shop.id)
  .gte("initiated_at", window.from)
  .lt("initiated_at", window.to)
  .order("initiated_at", { ascending: true });
if (disputeError) throw disputeError;

const productionDisputes = disputes.filter((row) => !isSyntheticDispute(row));
const syntheticDisputes = disputes.filter((row) => isSyntheticDispute(row));
const safeDisputes = disputes.map(({ raw_snapshot: _rawSnapshot, ...row }) => row);
const productionAmountsByCurrency = summarizeAmountsByCurrency(
  productionDisputes,
  window.days,
);
const singleProductionCurrency = singleCurrencySummary(productionAmountsByCurrency);
const productionSpanDays = window.days;

const [packs, packages, submissions, audit, events, jobs, webhooks] = await Promise.all([
  rows("evidence_packs", "id,dispute_id,status,submission_readiness,package_type,created_at,updated_at,last_saved_to_shopify_at,saved_to_shopify_at,failure_code,failure_reason", shop.id, window.from),
  rows("defence_packages", "id,dispute_id,status,created_at,updated_at,submitted_at", shop.id, window.from),
  rows("submission_logs", "id,dispute_id,channel,final_outcome,created_at,submitted_at", shop.id, window.from),
  rows("audit_events", "id,dispute_id,event_type,actor_type,created_at,event_payload", shop.id, window.from),
  rows("dispute_events", "id,dispute_id,event_type,source_type,event_at,created_at,metadata_json", shop.id, window.from),
  rows("jobs", "id,job_type,status,created_at,updated_at,last_error", shop.id, window.from),
  rows("webhook_events", "id,topic,outcome,received_at,processed_at,error_message", shop.id, window.from, "received_at"),
]);

const configReads = await Promise.all([
  db.from("shop_setup").select("*").eq("shop_id", shop.id).maybeSingle(),
  db.from("shop_settings").select("*").eq("shop_id", shop.id).maybeSingle(),
  db.from("rules").select("id,enabled,match,action,priority,created_at,updated_at").eq("shop_id", shop.id).order("priority", { ascending: false }),
  db.from("integrations").select("type,status,created_at,updated_at").eq("shop_id", shop.id),
  db.from("policy_snapshots").select("policy_type,captured_at").eq("shop_id", shop.id),
  db.from("pack_templates").select("id,name,status,created_at,updated_at").eq("shop_id", shop.id),
  db.from("pack_usage_events").select("event_type,packs,created_at").eq("shop_id", shop.id),
  db.from("app_events").select("name,created_at").eq("shop_id", shop.id).gte("created_at", window.from).lt("created_at", window.to),
  db.from("shop_daily_metrics").select("date,order_count,dispute_count,chargeback_count,inquiry_count,last_synced_at").eq("shop_id", shop.id).gte("date", reportFrom).lt("date", reportTo),
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
  reporting_window: window,
  shop,
  local: {
    disputes: safeDisputes,
    dispute_quality: {
      all_count: disputes.length,
      production_count: productionDisputes.length,
      synthetic_count: syntheticDisputes.length,
      synthetic_classification:
        "Repository fixture GID markers plus explicit raw_snapshot seed flags",
      production_by_outcome: countBy(productionDisputes, "final_outcome"),
      production_by_currency: countBy(productionDisputes, "currency_code"),
      production_by_reason: countBy(productionDisputes, "reason"),
      production_by_status: countBy(productionDisputes, "normalized_status"),
      production_by_submission_state: countBy(productionDisputes, "submission_state"),
      production_amount_by_currency: productionAmountsByCurrency,
      production_amount: singleProductionCurrency?.total ?? null,
      production_average_amount: singleProductionCurrency?.average ?? null,
      production_median_amount: singleProductionCurrency?.median ?? null,
      production_span_days: productionSpanDays,
      annualized_case_run_rate: productionSpanDays ? productionDisputes.length / productionSpanDays * 365 : 0,
      annualized_disputed_value_run_rate:
        singleProductionCurrency?.annualized_disputed_value_run_rate ?? null,
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
