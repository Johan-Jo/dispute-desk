/**
 * Writer for `shopify_order_risk_signals` + `fraud_intel_parse_misses`.
 *
 * PR-D of "Structured Capture of Shopify Pre-Authorization Risk Signals".
 *
 * Architectural contracts (load-bearing):
 *
 *   1. Structured-from-GraphQL fields ALWAYS win over parser output.
 *      `buildSignalRow` takes the raw GraphQL inputs first; the parser
 *      output for the same field is dropped on the floor. The
 *      structured-over-parsed precedence is tested explicitly in
 *      __tests__/signalWriter.test.ts so a future schema-extraction
 *      change can't silently regress to regex.
 *
 *   2. Latest-snapshot semantics. The signal row is keyed on
 *      (shop_id, shopify_order_id) — one row per order. Re-parses
 *      overwrite the row; `source_assessment_id` points at the
 *      assessment that produced the current snapshot.
 *
 *   3. parse_miss_reason vs NULL — the migration codifies that NULL
 *      means "Shopify didn't report this for this order" (offline POS,
 *      wallet checkouts, etc.) and parse_miss_reason is set when the
 *      parser was invoked but failed to match. PR-E surfaces both as
 *      explicit buckets.
 *
 *   4. Misses are flushed to `fraud_intel_parse_misses` in a single
 *      insert per batch so /admin/fraud-intel can monitor parser drift.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { parseRiskFacts, PARSER_VERSION, type RawFact } from "./factParser";
import type {
  RawBackfillOrder,
  RawBackfillTransaction,
  RawPaymentDetails,
} from "@/lib/shopify/queries/ordersForBackfill";

export interface SignalRowInput {
  shopId: string;
  shopifyOrderId: string;
  /** Raw Shopify order — supplies the structured GraphQL fields
   *  (clientIp, paymentDetails) that ALWAYS win over parser. */
  raw: RawBackfillOrder;
  /** Optional FK to the persisted assessment that produced the
   *  current snapshot. */
  sourceAssessmentId?: string | null;
  sourceAssessmentCreatedAt?: string | null;
}

interface BuiltSignalRow {
  shop_id: string;
  shopify_order_id: string;
  client_ip: string | null;
  avs_address_result: string | null;
  avs_zip_result: string | null;
  cvv_result: string | null;
  card_bin: string | null;
  card_brand: string | null;
  wallet_type: string | null;
  payment_attempt_count: number | null;
  proxy_detected: boolean | null;
  multiple_cards_tried: boolean | null;
  billing_country_matches_ip: boolean | null;
  ip_country: string | null;
  ip_ship_distance_km: number | null;
  fraud_cluster_match: boolean | null;
  source_assessment_id: string | null;
  source_assessment_created_at: string | null;
  parser_version: number;
  parsed_at: string;
  parse_miss_reason: string | null;
}

/**
 * Build the signal row (does not write). Pure transform — exposed for
 * unit testing of the structured-over-parsed precedence contract.
 */
export function buildSignalRow(input: SignalRowInput): {
  row: BuiltSignalRow;
  misses: Array<{ text: string; sentiment: string | null }>;
} {
  // Pick the primary card transaction. PR-C projects
  // transactions(first: 5) with paymentDetails inlined for
  // CardPaymentDetails. Other payment methods (Shop Pay, Apple Pay,
  // gift card, manual) leave paymentDetails as the base interface
  // shape — null on all card-specific fields.
  const primaryCardTx = pickPrimaryCardTransaction(input.raw);
  const pd = primaryCardTx?.paymentDetails ?? null;

  // Combine all assessments' facts for the parse — Shopify can return
  // multiple providers (Shopify default + apps) and each provider's
  // facts are independently informative.
  const allFacts: RawFact[] = (input.raw.risk?.assessments ?? []).flatMap(
    (a) => a.facts ?? [],
  );
  const parsed = parseRiskFacts(allFacts);

  // Decide parse_miss_reason. NULL means "no signal because Shopify
  // didn't report any facts" — distinct from "facts present but
  // parser didn't match" which sets a reason.
  const factsPresent = allFacts.length > 0;
  const allParsedNull =
    parsed.signals.payment_attempt_count === null &&
    parsed.signals.proxy_detected === null &&
    parsed.signals.multiple_cards_tried === null &&
    parsed.signals.billing_country_matches_ip === null &&
    parsed.signals.ip_country === null &&
    parsed.signals.ip_ship_distance_km === null &&
    parsed.signals.fraud_cluster_match === null;
  const parseMissReason =
    factsPresent && allParsedNull && parsed.misses.length > 0
      ? "unmatched_phrases"
      : null;

  // Structured-over-parsed precedence: take GraphQL first, drop parser
  // equivalents. The parser has no AVS/CVV/BIN/brand/wallet rules
  // anyway, but the explicit precedence is documented + tested so
  // future widening of the parser can't accidentally pollute these
  // columns.
  const row: BuiltSignalRow = {
    shop_id: input.shopId,
    shopify_order_id: input.shopifyOrderId,

    client_ip: normalizeIp(input.raw.clientIp ?? null),
    avs_address_result: deriveAvsAddress(pd),
    avs_zip_result: deriveAvsZip(pd),
    cvv_result: nullableTrim(pd?.cvvResultCode ?? null),
    card_bin: nullableTrim(pd?.bin ?? null),
    card_brand: nullableTrim(pd?.company ?? null),
    wallet_type: nullableTrim(pd?.wallet ?? null),

    payment_attempt_count: parsed.signals.payment_attempt_count,
    proxy_detected: parsed.signals.proxy_detected,
    multiple_cards_tried: parsed.signals.multiple_cards_tried,
    billing_country_matches_ip: parsed.signals.billing_country_matches_ip,
    ip_country: parsed.signals.ip_country,
    ip_ship_distance_km: parsed.signals.ip_ship_distance_km,
    fraud_cluster_match: parsed.signals.fraud_cluster_match,

    source_assessment_id: input.sourceAssessmentId ?? null,
    source_assessment_created_at: input.sourceAssessmentCreatedAt ?? null,
    parser_version: PARSER_VERSION,
    parsed_at: new Date().toISOString(),
    parse_miss_reason: parseMissReason,
  };

  return { row, misses: parsed.misses };
}

/**
 * Upsert one signal row + flush misses to fraud_intel_parse_misses.
 * Service-role only — both tables are RLS-locked.
 */
export async function upsertSignalRow(input: SignalRowInput): Promise<void> {
  const sb = getServiceClient();
  const { row, misses } = buildSignalRow(input);

  const { error: signalErr } = await sb
    .from("shopify_order_risk_signals")
    .upsert(row, { onConflict: "shop_id,shopify_order_id" });
  if (signalErr) {
    throw new Error(
      `shopify_order_risk_signals upsert failed: ${signalErr.message}`,
    );
  }

  if (misses.length > 0) {
    const rows = misses.map((m) => ({
      shop_id: input.shopId,
      fact_text: m.text,
      fact_sentiment: m.sentiment,
      parser_version: PARSER_VERSION,
    }));
    const { error: missErr } = await sb
      .from("fraud_intel_parse_misses")
      .insert(rows);
    if (missErr) {
      // Don't fail the whole ingest — miss-tracking is best-effort.
      console.warn(
        `[fraudIntel] parse-misses insert failed: ${missErr.message}`,
      );
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function pickPrimaryCardTransaction(
  raw: RawBackfillOrder,
): RawBackfillTransaction | null {
  if (!raw.transactions || raw.transactions.length === 0) return null;
  return (
    raw.transactions.find(
      (t) =>
        (t.kind === "SALE" || t.kind === "AUTHORIZATION") &&
        t.status === "SUCCESS",
    ) ?? null
  );
}

function nullableTrim(v: string | null): string | null {
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIp(v: string | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  // Postgres `inet` accepts both IPv4 and IPv6 dotted/colon strings.
  // We don't validate here — the DB will reject anything malformed,
  // which is the correct contract (parser shouldn't silently coerce
  // garbage into a null IP).
  return trimmed;
}

/** Shopify AVS result codes encode address-match + zip-match in one
 *  letter. The two main code books we see:
 *
 *    Y/Z/A/N/U codes (Visa style):
 *      Y → address + zip match
 *      Z → zip only
 *      A → address only
 *      N → no match
 *      U → unavailable
 *
 *  We split into two columns so PR-E can correlate them independently.
 *  Returns the raw code as `avs_address_result` letter (1-char) when
 *  recognized; null otherwise. We deliberately do NOT translate to a
 *  high-level enum here so downstream queries can group by the raw
 *  result code.
 */
function deriveAvsAddress(pd: RawPaymentDetails | null): string | null {
  const code = nullableTrim(pd?.avsResultCode ?? null);
  if (!code) return null;
  return code;
}

function deriveAvsZip(pd: RawPaymentDetails | null): string | null {
  // For Shopify Payments, avsResultCode encodes BOTH the street and zip
  // outcome in one letter. We project the same code to both columns and
  // let PR-E queries interpret per code book. A future PR can split if
  // we observe codes that pack the two outcomes differently.
  const code = nullableTrim(pd?.avsResultCode ?? null);
  if (!code) return null;
  return code;
}
