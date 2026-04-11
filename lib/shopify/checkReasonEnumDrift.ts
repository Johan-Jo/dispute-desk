/**
 * Shopify dispute-reason enum drift checker.
 *
 * Runs a GraphQL introspection against a connected shop, compares
 * ShopifyPaymentsDisputeReason's live enum values to the local
 * ALL_DISPUTE_REASONS list, writes an audit event + fires an admin
 * email if the diff changed since the last run.
 *
 * Used both by the standalone /api/cron/check-shopify-reasons route
 * (manual trigger / CLI script) and piggybacked on the publish-content
 * daily cron so the check runs automatically without needing a new
 * Vercel cron slot (Hobby plan caps at 2 crons total).
 *
 * Non-throwing: all error paths return a structured result so the
 * caller can decide whether to log or ignore. Drift alerting is
 * opportunistic — the reactive path in lib/disputes/syncDisputes.ts
 * is the authoritative safety net.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import { deserializeEncrypted, decrypt } from "@/lib/security/encryption";
import { ALL_DISPUTE_REASONS } from "@/lib/rules/disputeReasons";
import {
  REASON_ENUM_INTROSPECTION_QUERY,
  type ReasonEnumIntrospectionResponse,
} from "@/lib/shopify/queries/enumIntrospection";
import { sendReasonEnumDriftAlert } from "@/lib/email/sendReasonEnumDriftAlert";
import { sendReasonEnumDriftResolvedAlert } from "@/lib/email/sendReasonEnumDriftResolvedAlert";

export type DriftCheckResult =
  | { ok: true; skipped: "no_connected_shop" }
  | { ok: true; skipped: "no_shop_domain" }
  | {
      ok: true;
      skipped: "empty_enum_response";
      checkedShopDomain: string;
    }
  | {
      ok: true;
      drift: false;
      enumTotalCount: number;
      checkedShopDomain: string;
    }
  | {
      ok: true;
      drift: false;
      resolved: true;
      previousMissingLocally: string[];
      previousExtraLocally: string[];
      enumTotalCount: number;
      checkedShopDomain: string;
    }
  | {
      ok: true;
      drift: true;
      dedup: "already_alerted";
      missingLocally: string[];
      extraLocally: string[];
      checkedShopDomain: string;
    }
  | {
      ok: true;
      drift: true;
      alertSent: true;
      missingLocally: string[];
      extraLocally: string[];
      checkedShopDomain: string;
      enumTotalCount: number;
    }
  | { ok: false; error: "introspection_failed"; message: string };

function decryptAccessToken(encryptedToken: string): string {
  try {
    return decrypt(deserializeEncrypted(encryptedToken));
  } catch {
    return encryptedToken;
  }
}

function computeDiff(remote: string[], local: readonly string[]) {
  const remoteSet = new Set(remote);
  const localSet = new Set(local);
  const missingLocally = remote.filter((v) => !localSet.has(v)).sort();
  const extraLocally = local.filter((v) => !remoteSet.has(v)).sort();
  return { missingLocally, extraLocally };
}

function sameDiff(
  a: { missingLocally: string[]; extraLocally: string[] },
  b: { missingLocally: string[]; extraLocally: string[] },
): boolean {
  return (
    JSON.stringify(a.missingLocally) === JSON.stringify(b.missingLocally) &&
    JSON.stringify(a.extraLocally) === JSON.stringify(b.extraLocally)
  );
}

export async function checkShopifyReasonEnumDrift(): Promise<DriftCheckResult> {
  const sb = getServiceClient();

  const { data: session } = await sb
    .from("shop_sessions")
    .select("shop_id, access_token_encrypted, shops!inner(shop_domain)")
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
  if (!shopDomain) {
    return { ok: true, skipped: "no_shop_domain" };
  }

  const accessToken = decryptAccessToken(
    (session as { access_token_encrypted: string }).access_token_encrypted,
  );

  let enumValues: string[] = [];
  try {
    const res = await requestShopifyGraphQL<ReasonEnumIntrospectionResponse>({
      session: { shopDomain, accessToken },
      query: REASON_ENUM_INTROSPECTION_QUERY,
      variables: {},
    });
    enumValues = res.data?.__type?.enumValues?.map((v) => v.name) ?? [];
  } catch (err) {
    return {
      ok: false,
      error: "introspection_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (enumValues.length === 0) {
    return {
      ok: true,
      skipped: "empty_enum_response",
      checkedShopDomain: shopDomain,
    };
  }

  const currentDiff = computeDiff(enumValues, ALL_DISPUTE_REASONS);
  const isClean =
    currentDiff.missingLocally.length === 0 &&
    currentDiff.extraLocally.length === 0;

  // Look up the most recent audit event of either type. This is what
  // gates the "new drift", "dedup", and "resolved" transitions — we
  // only alert on state change.
  const { data: lastAudit } = await sb
    .from("audit_events")
    .select("event_type, event_payload")
    .in("event_type", [
      "shopify_enum_drift",
      "shopify_enum_drift_resolved",
    ])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastAuditType = lastAudit?.event_type as
    | "shopify_enum_drift"
    | "shopify_enum_drift_resolved"
    | undefined;

  if (isClean) {
    // Resolution transition: previous state was drift, now clean.
    // Write a resolution audit row and fire the "resolved" email so
    // the admin knows the fix landed. Subsequent clean runs will be
    // silent because lastAuditType will be 'shopify_enum_drift_resolved'.
    if (lastAuditType === "shopify_enum_drift") {
      const payload = lastAudit!.event_payload as {
        missing_locally?: string[];
        extra_locally?: string[];
      };
      const previousMissingLocally = (payload?.missing_locally ?? [])
        .slice()
        .sort();
      const previousExtraLocally = (payload?.extra_locally ?? [])
        .slice()
        .sort();

      await sb.from("audit_events").insert({
        shop_id: (session as { shop_id: string }).shop_id,
        actor_type: "system",
        event_type: "shopify_enum_drift_resolved",
        event_payload: {
          previous_missing_locally: previousMissingLocally,
          previous_extra_locally: previousExtraLocally,
          checked_shop_domain: shopDomain,
          enum_total_count: enumValues.length,
          resolved_at: new Date().toISOString(),
        },
      });

      void sendReasonEnumDriftResolvedAlert({
        previousMissingLocally,
        previousExtraLocally,
        checkedShopDomain: shopDomain,
        enumTotalCount: enumValues.length,
      });

      return {
        ok: true,
        drift: false,
        resolved: true,
        previousMissingLocally,
        previousExtraLocally,
        enumTotalCount: enumValues.length,
        checkedShopDomain: shopDomain,
      };
    }

    // Plain happy path: no drift, no previous drift to resolve. Silent.
    return {
      ok: true,
      drift: false,
      enumTotalCount: enumValues.length,
      checkedShopDomain: shopDomain,
    };
  }

  // Dedup: only skip the alert if the latest event was a drift with
  // the exact same diff. If the latest event was a resolution (or
  // there's no previous event), any new drift is genuinely new and
  // we alert.
  if (lastAuditType === "shopify_enum_drift") {
    const payload = lastAudit!.event_payload as {
      missing_locally?: string[];
      extra_locally?: string[];
    };
    const previousDiff = {
      missingLocally: (payload?.missing_locally ?? []).slice().sort(),
      extraLocally: (payload?.extra_locally ?? []).slice().sort(),
    };
    if (sameDiff(currentDiff, previousDiff)) {
      return {
        ok: true,
        drift: true,
        dedup: "already_alerted",
        missingLocally: currentDiff.missingLocally,
        extraLocally: currentDiff.extraLocally,
        checkedShopDomain: shopDomain,
      };
    }
  }

  await sb.from("audit_events").insert({
    shop_id: (session as { shop_id: string }).shop_id,
    actor_type: "system",
    event_type: "shopify_enum_drift",
    event_payload: {
      missing_locally: currentDiff.missingLocally,
      extra_locally: currentDiff.extraLocally,
      checked_shop_domain: shopDomain,
      enum_total_count: enumValues.length,
      detected_at: new Date().toISOString(),
    },
  });

  void sendReasonEnumDriftAlert({
    missingLocally: currentDiff.missingLocally,
    extraLocally: currentDiff.extraLocally,
    checkedShopDomain: shopDomain,
    enumTotalCount: enumValues.length,
  });

  return {
    ok: true,
    drift: true,
    alertSent: true,
    missingLocally: currentDiff.missingLocally,
    extraLocally: currentDiff.extraLocally,
    checkedShopDomain: shopDomain,
    enumTotalCount: enumValues.length,
  };
}
