#!/usr/bin/env node
/**
 * Hydrate shopify_order_risk_signals from existing shopify_order_risk_assessments.
 *
 * One-shot script — PR-D of "Structured Capture of Shopify Pre-Authorization
 * Risk Signals". Walks the latest assessment per (shop, order), runs the
 * factParser, and upserts the signal row. Idempotent: re-running overwrites
 * the row with the current PARSER_VERSION.
 *
 * Important limitation: the structured-from-GraphQL fields (client_ip,
 * paymentDetails) are NOT recovered here because they were never persisted
 * in the assessments table. This script only fills the parsed columns —
 * future ingests (webhook, reconciliation cron) overwrite the same row
 * with structured values from the wider GraphQL projection (PR-C).
 *
 * Usage:
 *   node scripts/hydrate-risk-signals.mjs
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

// Lazy-import so this script doesn't need a TypeScript build. We
// import the parser from the .ts source via the ts-node loader, OR
// re-implement enough of it inline. Using dynamic import + esbuild
// is the cleanest path for one-shot scripts.
const { parseRiskFacts, PARSER_VERSION } = await loadParser();

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const PAGE = 500;
let processed = 0;
let upserted = 0;
let missing = 0;

async function main() {
  // Walk distinct (shop_id, shopify_order_id) — using the latest
  // assessment per order. Postgres doesn't have a clean "DISTINCT ON"
  // through supabase-js, so we paginate by `id` and dedup in memory.
  let lastId = null;
  while (true) {
    let q = sb
      .from("shopify_order_risk_assessments")
      .select("id, shop_id, shopify_order_id, facts_json, snapshot_at")
      .order("id", { ascending: true })
      .limit(PAGE);
    if (lastId) q = q.gt("id", lastId);

    const { data, error } = await q;
    if (error) {
      console.error("Query failed:", error.message);
      break;
    }
    if (!data || data.length === 0) break;

    // Dedup: only keep the highest snapshot_at per (shop, order).
    const byKey = new Map();
    for (const row of data) {
      const key = `${row.shop_id}|${row.shopify_order_id}`;
      const existing = byKey.get(key);
      if (!existing || row.snapshot_at > existing.snapshot_at) {
        byKey.set(key, row);
      }
    }

    for (const row of byKey.values()) {
      const facts = Array.isArray(row.facts_json) ? row.facts_json : [];
      const { signals, misses } = parseRiskFacts(facts);
      const factsPresent = facts.length > 0;
      const allParsedNull =
        signals.payment_attempt_count === null &&
        signals.proxy_detected === null &&
        signals.multiple_cards_tried === null &&
        signals.billing_country_matches_ip === null &&
        signals.ip_country === null &&
        signals.ip_ship_distance_km === null &&
        signals.fraud_cluster_match === null;
      const parseMissReason =
        factsPresent && allParsedNull && misses.length > 0
          ? "unmatched_phrases"
          : null;

      const { error: upErr } = await sb
        .from("shopify_order_risk_signals")
        .upsert(
          {
            shop_id: row.shop_id,
            shopify_order_id: row.shopify_order_id,
            payment_attempt_count: signals.payment_attempt_count,
            proxy_detected: signals.proxy_detected,
            multiple_cards_tried: signals.multiple_cards_tried,
            billing_country_matches_ip: signals.billing_country_matches_ip,
            ip_country: signals.ip_country,
            ip_ship_distance_km: signals.ip_ship_distance_km,
            fraud_cluster_match: signals.fraud_cluster_match,
            source_assessment_id: row.id,
            source_assessment_created_at: row.snapshot_at,
            parser_version: PARSER_VERSION,
            parsed_at: new Date().toISOString(),
            parse_miss_reason: parseMissReason,
          },
          { onConflict: "shop_id,shopify_order_id" },
        );
      if (upErr) {
        console.warn(`upsert ${row.shopify_order_id}: ${upErr.message}`);
        missing++;
      } else {
        upserted++;
      }

      if (misses.length > 0) {
        await sb.from("fraud_intel_parse_misses").insert(
          misses.map((m) => ({
            shop_id: row.shop_id,
            fact_text: m.text,
            fact_sentiment: m.sentiment,
            parser_version: PARSER_VERSION,
          })),
        );
      }

      processed++;
    }

    lastId = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }

  console.log(
    JSON.stringify({ processed, upserted, missing }, null, 2),
  );
}

async function loadParser() {
  // The factParser lives in lib/fraudIntel/factParser.ts. Dynamic
  // import works under Next's tsconfig only when compiled. For the
  // one-shot script we inline a minimal subset of the rules; the
  // production parser is the authoritative implementation used by
  // ingest.
  //
  // The inline subset must stay in lock-step with lib/fraudIntel/factParser.ts.
  // CI's vitest covers the real parser; this script's regex set is a
  // pragmatic snapshot for the hydration backfill.
  return {
    PARSER_VERSION: 1,
    parseRiskFacts: (facts) => {
      const signals = {
        payment_attempt_count: null,
        proxy_detected: null,
        multiple_cards_tried: null,
        billing_country_matches_ip: null,
        ip_country: null,
        ip_ship_distance_km: null,
        fraud_cluster_match: null,
      };
      const misses = [];
      for (const f of facts ?? []) {
        const text = (f?.description ?? "").trim();
        if (!text) continue;
        const sentiment = (f?.sentiment ?? "").toUpperCase();
        let matched = false;
        if (
          sentiment === "NEGATIVE" &&
          /\b(proxy|vpn|tor|anonymous(?:\s+ip)?|anonymizer)\b/i.test(text)
        ) {
          signals.proxy_detected = true;
          matched = true;
        }
        if (
          sentiment === "NEGATIVE" &&
          /\b(?:multiple|several|\d+)\s+(?:different\s+)?(?:credit\s+)?(?:cards?|payment\s+methods?)\b/i.test(
            text,
          )
        ) {
          signals.multiple_cards_tried = true;
          matched = true;
        }
        const attempts = /\b(\d+)\s+(?:payment\s+)?attempts?\s+(?:to\s+)?charge\b/i.exec(text);
        if (attempts) {
          const n = parseInt(attempts[1], 10);
          if (Number.isFinite(n)) {
            signals.payment_attempt_count = n;
            matched = true;
          }
        }
        const dist = /\b(\d{1,5}(?:,\d{3})*)\s*km\b.*(?:between\s+the?\s+)?(?:ip|customer)\s+(?:and|to)\s+(?:shipping|delivery)/i.exec(
          text,
        );
        if (dist) {
          const km = parseInt(dist[1].replace(/,/g, ""), 10);
          if (Number.isFinite(km)) {
            signals.ip_ship_distance_km = km;
            matched = true;
          }
        }
        if (
          sentiment === "NEGATIVE" &&
          /\b(?:fraud(?:ulent)?\s+(?:cluster|pattern|network)|matches?\s+(?:a\s+)?(?:known\s+)?fraud(?:ulent)?\s+pattern|associated\s+with\s+(?:known\s+)?fraud)/i.test(
            text,
          )
        ) {
          signals.fraud_cluster_match = true;
          matched = true;
        }
        if (!matched) misses.push({ text, sentiment: sentiment || null });
      }
      return { signals, misses };
    },
  };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
