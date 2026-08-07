/**
 * The ONE predicate that decides whether a defence-package candidate may be
 * saved to Shopify or forwarded (PR-C1).
 *
 * WHY A CENTRAL PREDICATE. A code release stops NEW unsafe output; it does
 * nothing about packages already sitting in `defence_packages`. Measured on
 * production at 2026-08-07T12:14:36.434Z: 173 package versions across 64
 * disputes carry either a retired delivery boolean in their persisted facts or
 * an address-delivery assertion in their persisted narrative. Without a block,
 * the very next auto-save, manual save, or deadline run would file one.
 *
 * CANDIDATE-BASED, NOT DISPUTE-BASED. Unsafety is a property of one persisted
 * version, never of the dispute:
 *   - a historical unsafe version stays immutable and stays blocked;
 *   - a newly regenerated safe version is a different candidate and is usable;
 *   - the existence of an older unsafe version must never permanently block a
 *     dispute;
 *   - and a selector must never fall back from a new safe-or-failed candidate
 *     to an older unsafe one. Both selectors (`saveToShopifyJob` §3 and the
 *     deadline cron) already take `order by version desc limit 1` — the latest
 *     candidate only — and this module must not be used to reintroduce a
 *     search for "the newest SAFE version", which would be exactly that
 *     forbidden fallback.
 *
 * NOT A DATA REWRITE. Nothing here mutates a package. Unsafe candidates stay
 * viewable; they are refused at the save/forward boundary and the merchant is
 * told why.
 */

import { classifyAddressDeliveryClaim } from "./claimCapabilities";
import {
  RETIRED_PAYLOAD_KEYS,
  type RetiredPayloadKey,
} from "@/lib/evidence/model/retiredKeys";

export type PackageUnsafeReason =
  /** A persisted fact value still carries a retired delivery boolean. */
  | "retired_delivery_fact"
  /** The narrative affirmatively asserts delivery at a particular address. */
  | "affirmative_address_delivery_claim"
  /** Address-delivery language we could not resolve. Fails closed. */
  | "ambiguous_address_delivery_claim";

export interface PackageSafetyVerdict {
  safe: boolean;
  reasons: PackageUnsafeReason[];
  /** Retired keys found, for the audit row. Never merchant- or bank-facing. */
  retiredKeys: RetiredPayloadKey[];
}

export interface PackageSafetyInput {
  /** `defence_packages.facts_json` exactly as persisted. */
  factsJson: unknown;
  /** `defence_packages.narrative_json` exactly as persisted. */
  narrativeJson: unknown;
}

/** Every fact-like object in a persisted `facts_json`, whatever the shape.
 *  Older rows are a bare array; newer ones may be wrapped. Unknown shapes
 *  yield nothing rather than throwing — an unreadable candidate is handled by
 *  the caller's own status checks, not by guessing. */
function factObjects(factsJson: unknown): Record<string, unknown>[] {
  const list = Array.isArray(factsJson)
    ? factsJson
    : factsJson && typeof factsJson === "object"
      ? ((factsJson as Record<string, unknown>).approved ??
         (factsJson as Record<string, unknown>).facts ??
         (factsJson as Record<string, unknown>).approvedFacts)
      : null;
  if (!Array.isArray(list)) return [];
  return list.filter((f): f is Record<string, unknown> => !!f && typeof f === "object");
}

/** Every string of prose in a persisted `narrative_json`, whatever the shape. */
export function narrativeTexts(narrativeJson: unknown): string[] {
  if (!narrativeJson || typeof narrativeJson !== "object") return [];
  const out: string[] = [];
  for (const value of Object.values(narrativeJson as Record<string, unknown>)) {
    if (typeof value === "string") {
      out.push(value);
    } else if (value && typeof value === "object") {
      const text = (value as Record<string, unknown>).text;
      if (typeof text === "string") out.push(text);
    }
  }
  return out;
}

export function assessPackageCandidateSafety(
  input: PackageSafetyInput,
): PackageSafetyVerdict {
  const reasons = new Set<PackageUnsafeReason>();
  const retiredKeys = new Set<RetiredPayloadKey>();

  for (const fact of factObjects(input.factsJson)) {
    const value = fact.value;
    if (!value || typeof value !== "object") continue;
    for (const key of RETIRED_PAYLOAD_KEYS) {
      if (key in (value as Record<string, unknown>)) {
        retiredKeys.add(key);
        reasons.add("retired_delivery_fact");
      }
    }
  }

  for (const text of narrativeTexts(input.narrativeJson)) {
    const verdict = classifyAddressDeliveryClaim(text);
    if (verdict === "affirmative") reasons.add("affirmative_address_delivery_claim");
    else if (verdict === "ambiguous") reasons.add("ambiguous_address_delivery_claim");
  }

  return {
    safe: reasons.size === 0,
    reasons: [...reasons],
    retiredKeys: [...retiredKeys],
  };
}

/** Merchant-safe explanation for the block. No bank-facing language, no
 *  gateway codes, no address data. */
export function packageBlockSummary(verdict: PackageSafetyVerdict): string {
  if (verdict.safe) return "";
  return (
    "This defence package was built with a delivery-address claim DisputeDesk " +
    "can no longer support, so it will not be filed. Regenerate the package to " +
    "produce a version that can be submitted."
  );
}
