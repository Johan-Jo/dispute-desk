/**
 * Runtime query-field drift checker.
 *
 * Daily cron sends every dry-run-safe production query string to
 * Shopify Admin GraphQL with stub variables (registry in
 * `lib/shopify/queries/registry.ts`). Shopify validates schema BEFORE
 * resolving any fields, so an `undefinedField` error in the response
 * envelope is a precise signal that the live schema dropped a field
 * we still select. The checker classifies those errors, dedups
 * against the prior audit, and fires a single admin alert per state
 * change.
 *
 * Companion to `lib/shopify/checkReasonEnumDrift.ts` — runs from the
 * same cron route so we burn no extra Vercel cron slots.
 *
 * Why dry-run instead of introspect-and-validate:
 *   - No new dependency (graphql-js would add ~250 KB for one cron).
 *   - Shopify is authoritative on what its API accepts; introspection
 *     can drift from the actual executor in edge cases.
 *   - Stub IDs (`gid://shopify/<Type>/0`) are syntactically valid but
 *     resolve to nothing, so we never read real data and never hit a
 *     state-changing resolver. Mutations are excluded entirely; the
 *     static deny-list in `__tests__/schemaDriftGuard.test.ts` is
 *     their only guard.
 *
 * Non-throwing: every error path returns a structured result so the
 * caller can decide whether to log or escalate.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";
import { DRY_RUN_QUERIES } from "@/lib/shopify/queries/registry";
import { sendQueryFieldDriftAlert } from "@/lib/email/sendQueryFieldDriftAlert";
import { sendQueryFieldDriftResolvedAlert } from "@/lib/email/sendQueryFieldDriftResolvedAlert";

export interface QueryFieldDriftRow {
  /** Registry name of the query that failed (e.g. ORDER_DETAIL_QUERY). */
  query: string;
  /** Shopify parent type the missing field was selected on (e.g. "Order"). */
  type: string;
  /** The selected field that no longer exists on `type`. */
  field: string;
  /** Raw error message from Shopify, kept for the audit row. */
  message: string;
}

export type QueryFieldDriftCheckResult =
  | { ok: true; skipped: "no_connected_shop" }
  | { ok: true; skipped: "no_shop_domain" }
  | {
      ok: true;
      drift: false;
      checkedShopDomain: string;
      queriesChecked: number;
    }
  | {
      ok: true;
      drift: false;
      resolved: true;
      previousDrift: QueryFieldDriftRow[];
      checkedShopDomain: string;
      queriesChecked: number;
    }
  | {
      ok: true;
      drift: true;
      dedup: "already_alerted";
      driftRows: QueryFieldDriftRow[];
      checkedShopDomain: string;
      queriesChecked: number;
    }
  | {
      ok: true;
      drift: true;
      alertSent: true;
      driftRows: QueryFieldDriftRow[];
      checkedShopDomain: string;
      queriesChecked: number;
    }
  | { ok: false; error: "no_session"; message: string }
  | { ok: false; error: "check_failed"; message: string };

/**
 * Parse one Shopify GraphQL error into an undefinedField row when
 * applicable, otherwise return null.
 *
 * Shopify currently emits `extensions.code = "undefinedField"` for the
 * "Field 'X' doesn't exist on type 'Y'" class of error, but historically
 * older API versions used different codes — the regex fallback captures
 * both. Either signal is sufficient; both are treated identically.
 */
function classifyError(
  queryName: string,
  err: { message: string; extensions?: Record<string, unknown> },
): QueryFieldDriftRow | null {
  const ext = err.extensions ?? {};
  const codeRaw = (ext.code as unknown) ?? "";
  const code = typeof codeRaw === "string" ? codeRaw.toLowerCase() : "";

  const isUndefinedFieldCode =
    code === "undefinedfield" || code === "undefined_field";

  // Regex fallback for shapes where `extensions.code` is absent or
  // renamed in a future API version. The error message format has been
  // stable across every 20XX-MM API rev we've encountered.
  const re = /Field '([^']+)' doesn't exist on type '([^']+)'/;
  const m = err.message.match(re);

  if (!isUndefinedFieldCode && !m) return null;

  const field = m?.[1] ?? (ext.fieldName as string | undefined) ?? "(unknown)";
  const type = m?.[2] ?? (ext.typeName as string | undefined) ?? "(unknown)";

  return { query: queryName, type, field, message: err.message };
}

function sortKey(rows: QueryFieldDriftRow[]): string {
  return rows
    .map((r) => `${r.query}|${r.type}.${r.field}`)
    .sort()
    .join(",");
}

function sameDrift(
  a: QueryFieldDriftRow[],
  b: QueryFieldDriftRow[],
): boolean {
  return sortKey(a) === sortKey(b);
}

/**
 * Run the dry-run drift check against every entry in DRY_RUN_QUERIES,
 * write an audit row + send an admin email on state change. Idempotent
 * within a state; safe to invoke multiple times per day.
 */
export async function checkShopifyQueryFieldDrift(): Promise<QueryFieldDriftCheckResult> {
  const sb = getServiceClient();

  const { data: session } = await sb
    .from("shop_sessions")
    .select("shop_id, shops!inner(shop_domain)")
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    return { ok: true, skipped: "no_connected_shop" };
  }

  const shopRelation = (session as { shops: unknown }).shops;
  const shopRow = Array.isArray(shopRelation)
    ? (shopRelation[0] as { shop_domain: string })
    : (shopRelation as { shop_domain: string });
  const shopDomain = shopRow?.shop_domain;
  const shopId = (session as { shop_id: string }).shop_id;
  if (!shopDomain || !shopId) {
    return { ok: true, skipped: "no_shop_domain" };
  }

  const driftRows: QueryFieldDriftRow[] = [];

  for (const entry of DRY_RUN_QUERIES) {
    try {
      const res = await makeAuthedRequest({
        shopId,
        query: entry.body,
        variables: entry.stubVariables ?? {},
      });
      const errs = res.errors ?? [];
      for (const err of errs) {
        const row = classifyError(entry.name, err);
        if (row) driftRows.push(row);
      }
    } catch (err) {
      // Transport failure is not drift — log and move on. The next
      // run will retry. Throwing here would mask real drift detected
      // on the other queries.
      console.warn(
        "[checkQueryFieldDrift] transport failed for",
        entry.name,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const queriesChecked = DRY_RUN_QUERIES.length;
  const isClean = driftRows.length === 0;

  const { data: lastAudit } = await sb
    .from("audit_events")
    .select("event_type, event_payload")
    .in("event_type", [
      "shopify_query_field_drift",
      "shopify_query_field_drift_resolved",
    ])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastAuditType = lastAudit?.event_type as
    | "shopify_query_field_drift"
    | "shopify_query_field_drift_resolved"
    | undefined;

  if (isClean) {
    if (lastAuditType === "shopify_query_field_drift") {
      const previousDrift = (((lastAudit!.event_payload as Record<string, unknown>)
        .drift_rows ?? []) as QueryFieldDriftRow[])
        .slice()
        .sort((a, b) => sortKey([a]).localeCompare(sortKey([b])));

      await sb.from("audit_events").insert({
        shop_id: shopId,
        actor_type: "system",
        event_type: "shopify_query_field_drift_resolved",
        event_payload: {
          previous_drift_rows: previousDrift,
          checked_shop_domain: shopDomain,
          queries_checked: queriesChecked,
          resolved_at: new Date().toISOString(),
        },
      });

      void sendQueryFieldDriftResolvedAlert({
        previousDrift,
        checkedShopDomain: shopDomain,
        queriesChecked,
      });

      return {
        ok: true,
        drift: false,
        resolved: true,
        previousDrift,
        checkedShopDomain: shopDomain,
        queriesChecked,
      };
    }

    return {
      ok: true,
      drift: false,
      checkedShopDomain: shopDomain,
      queriesChecked,
    };
  }

  // Dedup: same exact drift as the previous alert → silent.
  if (lastAuditType === "shopify_query_field_drift") {
    const previousDrift = ((lastAudit!.event_payload as Record<string, unknown>)
      .drift_rows ?? []) as QueryFieldDriftRow[];
    if (sameDrift(driftRows, previousDrift)) {
      return {
        ok: true,
        drift: true,
        dedup: "already_alerted",
        driftRows,
        checkedShopDomain: shopDomain,
        queriesChecked,
      };
    }
  }

  await sb.from("audit_events").insert({
    shop_id: shopId,
    actor_type: "system",
    event_type: "shopify_query_field_drift",
    event_payload: {
      drift_rows: driftRows,
      checked_shop_domain: shopDomain,
      queries_checked: queriesChecked,
      detected_at: new Date().toISOString(),
    },
  });

  void sendQueryFieldDriftAlert({
    driftRows,
    checkedShopDomain: shopDomain,
    queriesChecked,
  });

  return {
    ok: true,
    drift: true,
    alertSent: true,
    driftRows,
    checkedShopDomain: shopDomain,
    queriesChecked,
  };
}
