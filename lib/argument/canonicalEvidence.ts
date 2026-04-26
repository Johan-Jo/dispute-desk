/**
 * Canonical evidence registry.
 *
 * Plan v3 §P2.4 + P2.4a + P2.4b. **The single source of truth** for:
 *   - Per-evidence-field category (`strong` | `moderate` | `supporting` |
 *     `invalid`).
 *   - The `signalId` that scoring uses for cross-key deduplication.
 *   - Per-field weight (3/2/0).
 *   - Conditional categorization rules (e.g. delivery proofType).
 *
 * Hard rules:
 *   - **No code outside this file may assign a category** to an evidence
 *     item. Enforced by the CI grep guard. (P2.4b)
 *   - The persisted `category` on `pack.evidenceItems[*]` is a **cache,
 *     not authority**. It is recomputed on every pack build and on read
 *     when `categoryVersion` mismatches. (P2.4a)
 *   - **Supporting items NEVER elevate case strength.** `weight = 0` and
 *     `excludedFromStrength = true` for every supporting entry. (P2.1.1)
 *   - **Deduplication uses `signalId`**, not `evidenceFieldKey`. (P2.4)
 */

/** Strict 4-state category. `invalid` items never enter the system. */
export type EvidenceCategory = "strong" | "moderate" | "supporting" | "invalid";

/** Signal-level ID used for scoring deduplication. Multiple
 *  `evidenceFieldKey`s may share a `signalId` when they describe the
 *  same underlying evidentiary signal. */
export type SignalId =
  | "payment_auth"
  | "billing_match"
  | "delivery"
  | "ip_location"
  | "device_session"
  | "communication"
  | "account_history"
  | "order_record"
  | "product_listing"
  | "policy_refund"
  | "policy_shipping"
  | "policy_cancellation"
  | "duplicate_explanation"
  | "supplementary_documents";

/** Weight per category. Used by the count-based scorer. */
export const CATEGORY_WEIGHT: Record<EvidenceCategory, number> = {
  strong: 3,
  moderate: 2,
  supporting: 0,
  invalid: 0,
};

/**
 * Bumped whenever the categorization rules change. Persisted alongside
 * each evidence item so the workspace API can detect stale caches and
 * recompute on read. Plan §P2.4a.
 */
export const CANONICAL_EVIDENCE_VERSION = 1;

/** Persisted alongside an evidence item so we know which registry
 *  version classified it. */
export interface PersistedCategory {
  category: EvidenceCategory;
  signalId: SignalId;
  categoryVersion: number;
}

/** Static spec per `evidenceFieldKey`. The `category` here is the
 *  **default** category — conditional rules below may downgrade it
 *  based on payload contents (e.g. `delivery_proof` defaults to
 *  `moderate` but downgrades to `invalid` when only a label is
 *  recorded). */
export interface CanonicalSpec {
  /** Cross-field signal grouping for dedup. */
  signalId: SignalId;
  /** Merchant-facing label. */
  label: string;
  /** Default category. May be downgraded by conditional rules. */
  category: EvidenceCategory;
  /** True when this signal can never elevate case strength
   *  regardless of presence. Mirrors `category === "supporting"`
   *  but kept as an explicit flag so consumers don't have to
   *  re-derive. (P2.1.1) */
  supportingOnly: boolean;
  /** True when the scorer must skip this entirely. Identical to
   *  `supportingOnly` for the canonical 4-state system; kept as a
   *  separate flag for forward compatibility with future tiers. */
  excludedFromStrength: boolean;
  /** Optional human note (audit-log friendly). */
  note?: string;
}

/* ── Registry ── */

/**
 * Canonical evidence registry. Indexed by `evidenceFieldKey`.
 *
 * Strong (weight 3): directly proves authorization or delivery to the
 *   cardholder.
 * Moderate (weight 2): supports but is not decisive on its own.
 * Supporting (weight 0): context only — never elevates strength.
 *
 * Conditional fields (`avs_cvv_match`, `delivery_proof`,
 * `ip_location_check`, `device_session_consistency`) declare their
 * **best-case** category here; `categorizeEvidenceField()` may
 * downgrade based on payload contents.
 */
export const CANONICAL_EVIDENCE: Record<string, CanonicalSpec> = {
  // ── Payment authentication ──
  avs_cvv_match: {
    signalId: "payment_auth",
    label: "Payment authentication (AVS + CVV)",
    category: "strong",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong only when BOTH AVS and CVV match. Otherwise moderate (one match) or invalid (none).",
  },
  tds_authentication: {
    signalId: "payment_auth",
    label: "3-D Secure authentication",
    category: "strong",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when 3DS verified. Invalid when 3DS data not available.",
  },

  // ── Billing match ──
  billing_address_match: {
    signalId: "billing_match",
    label: "Billing address match",
    category: "strong",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when AVS-confirmed billing matches the cardholder. Invalid otherwise.",
  },

  // ── Delivery (proofType-conditional) ──
  delivery_proof: {
    signalId: "delivery",
    label: "Delivery confirmation",
    category: "moderate",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "signature_confirmed → strong; delivered_confirmed AND deliveredToVerifiedAddress → strong (rubric #9); delivered_confirmed alone → moderate; delivered_unverified → supporting; label_created → invalid.",
  },
  shipping_tracking: {
    signalId: "delivery",
    label: "Shipping tracking",
    category: "moderate",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Same 4-state proofType mapping as delivery_proof, with the deliveredToVerifiedAddress upgrade for delivered_confirmed. Shares signalId 'delivery' so duplicate evidence does not double-count.",
  },

  // ── IP / device (always at most moderate) ──
  ip_location_check: {
    signalId: "ip_location",
    label: "IP & location consistency",
    category: "moderate",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Moderate when location matches AND no VPN/proxy flag. Supporting when partial match. Invalid when payload missing.",
  },
  device_session_consistency: {
    signalId: "device_session",
    label: "Device & session signals",
    category: "moderate",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when consistent AND login present AND IP/device match (rubric #4); moderate when consistent only; supporting otherwise.",
  },

  // ── Conditionally upgradable (rubric: text-only is supporting,
  //     decisive payload is strong). Default category is `supporting`
  //     and `supportingOnly: false` so the categorizer can upgrade
  //     when payload carries the discriminator. ──
  customer_communication: {
    signalId: "communication",
    label: "Customer communication",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when payload.customerConfirmsOrder === true (rubric #6 — explicit confirmation/admission). Otherwise supporting.",
  },
  customer_account_info: {
    signalId: "account_history",
    label: "Customer account history",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when prior undisputed orders exist for the same customer (rubric #5 — payload.priorUndisputedOrders >= 1, OR payload.totalOrders >= 1 and payload.disputeFreeHistory !== false). Otherwise supporting.",
  },
  activity_log: {
    signalId: "account_history",
    label: "Customer activity log",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when payload.decisiveSessionProof === true (rubric #4 — login + consistent device/session/IP) OR payload.digitalAccessUsed === true (rubric #7 — customer accessed/used digital good). Otherwise supporting. Shares signalId 'account_history' with customer_account_info — counted once in scoring.",
  },
  supporting_documents: {
    signalId: "supplementary_documents",
    label: "Supplementary documents",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when payload.signedContract === true (rubric #3 — signed agreement / contract). Otherwise supporting (uploaded documents without decisive content).",
  },
  refund_policy: {
    signalId: "policy_refund",
    label: "Refund policy",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Strong when payload.acceptedAtCheckout === true with a payload.acceptanceTimestamp linking to the order (rubric #8). Otherwise supporting (text only).",
  },
  shipping_policy: {
    signalId: "policy_shipping",
    label: "Shipping policy",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Same acceptance rule as refund_policy (rubric #8).",
  },
  cancellation_policy: {
    signalId: "policy_cancellation",
    label: "Cancellation policy",
    category: "supporting",
    supportingOnly: false,
    excludedFromStrength: false,
    note: "Same acceptance rule as refund_policy (rubric #8).",
  },

  // ── Strict supporting-only (rubric: never elevates regardless of
  //     payload). Order record, product listing, duplicate explanation
  //     are always supporting per the rubric's GRAY list. ──
  order_confirmation: {
    signalId: "order_record",
    label: "Order record",
    category: "supporting",
    supportingOnly: true,
    excludedFromStrength: true,
  },
  product_description: {
    signalId: "product_listing",
    label: "Product listing",
    category: "supporting",
    supportingOnly: true,
    excludedFromStrength: true,
  },
  duplicate_explanation: {
    signalId: "duplicate_explanation",
    label: "Duplicate-charge explanation",
    category: "supporting",
    supportingOnly: true,
    excludedFromStrength: true,
  },
};

/* ── Categorizer ── */

/** AVS result codes Shopify exposes that count as a match.
 *  Y = full match (street+zip), A = address match only, W = zip match only,
 *  X = full match (international), D/M = international match. */
const AVS_MATCH_CODES = new Set(["Y", "A", "W", "X", "D", "M"]);
/** CVV result codes that count as a match. M = match. */
const CVV_MATCH_CODES = new Set(["M"]);

/** Delivery proofType discriminator written by the fulfillment
 *  collector. The four canonical states. (P2.3) */
export type DeliveryProofType =
  | "signature_confirmed"
  | "delivered_confirmed"
  | "delivered_unverified"
  | "label_created";

/**
 * Classify an evidence item by `evidenceFieldKey` + payload.
 *
 * The ONE allowed mapper from data → category. Anything that needs to
 * know the category MUST go through this function (or read the
 * persisted `category` cache when its version matches). No alternate
 * paths, no per-family overrides, no UI-side inference.
 */
export function categorizeEvidenceField(
  fieldKey: string,
  payload: Record<string, unknown> | null | undefined,
): EvidenceCategory {
  const spec = CANONICAL_EVIDENCE[fieldKey];
  // Unknown field → invalid (excluded from the system).
  if (!spec) return "invalid";

  // Supporting fields are unconditional — presence is the only check,
  // and supporting items never affect strength.
  if (spec.supportingOnly) {
    return payload ? "supporting" : "invalid";
  }

  const p = (payload ?? {}) as Record<string, unknown>;

  // ── delivery_proof / shipping_tracking ──
  // Rubric #2 + #9. signature_confirmed always strong. delivered_confirmed
  // is strong when payload confirms delivery to the verified billing /
  // customer address (no mismatch); otherwise moderate. delivered_unverified
  // → supporting. label_created → invalid (explicit negative).
  if (fieldKey === "delivery_proof" || fieldKey === "shipping_tracking") {
    const proofType = (p.proofType ?? "label_created") as DeliveryProofType;
    switch (proofType) {
      case "signature_confirmed":
        return "strong";
      case "delivered_confirmed":
        return p.deliveredToVerifiedAddress === true ? "strong" : "moderate";
      case "delivered_unverified":
        return "supporting";
      case "label_created":
      default:
        return "invalid";
    }
  }

  // ── avs_cvv_match ── (rubric #1)
  if (fieldKey === "avs_cvv_match") {
    const avs = String(p.avsResultCode ?? "").toUpperCase();
    const cvv = String(p.cvvResultCode ?? "").toUpperCase();
    const avsOk = AVS_MATCH_CODES.has(avs);
    const cvvOk = CVV_MATCH_CODES.has(cvv);
    if (avsOk && cvvOk) return "strong";
    if (avsOk || cvvOk) return "moderate";
    return "invalid";
  }

  // ── tds_authentication ──
  if (fieldKey === "tds_authentication") {
    return p.tdsVerified === true ? "strong" : "invalid";
  }

  // ── billing_address_match ──
  if (fieldKey === "billing_address_match") {
    return p.match === true ? "strong" : "invalid";
  }

  // ── ip_location_check ──
  if (fieldKey === "ip_location_check") {
    if (p.bankEligible === false) return "supporting";
    const privacy = (p.ipinfo as { privacy?: { vpn?: boolean; proxy?: boolean; hosting?: boolean } } | undefined)?.privacy;
    if (privacy?.vpn || privacy?.proxy || privacy?.hosting) return "supporting";
    if (p.locationMatch === "match" || p.locationMatch === "country_match") return "moderate";
    return "supporting";
  }

  // ── device_session_consistency ── (rubric #4)
  // Strong: consistent + login present + IP/device match.
  // Moderate: consistent (no decisive session signals).
  // Supporting: anything else.
  if (fieldKey === "device_session_consistency") {
    if (p.consistent === true && p.loginPresent === true && p.ipMatch === true) {
      return "strong";
    }
    return p.consistent === true ? "moderate" : "supporting";
  }

  // ── customer_communication ── (rubric #6)
  // Strong only when the customer explicitly confirms purchase / delivery
  // / use / satisfaction. Otherwise supporting (mere existence of a
  // conversation is not decisive).
  if (fieldKey === "customer_communication") {
    return p.customerConfirmsOrder === true ? "strong" : "supporting";
  }

  // ── customer_account_info ── (rubric #5: prior undisputed transaction history)
  // Strong: prior undisputed orders exist for this customer/card/email/
  // address. Conservative — never upgrade if disputeFreeHistory is
  // explicitly false (would be misleading).
  if (fieldKey === "customer_account_info") {
    if (p.disputeFreeHistory === false) return "supporting";
    const prior = Number(p.priorUndisputedOrders ?? 0);
    const totalOrders = Number(p.totalOrders ?? 0);
    if (prior >= 1) return "strong";
    if (totalOrders >= 1 && p.disputeFreeHistory !== false) return "strong";
    return "supporting";
  }

  // ── activity_log ── (rubric #4 + #7)
  // Strong: decisive session proof (login + consistent device/session/IP)
  // OR digital access proof (customer accessed, downloaded, activated,
  // logged in, or used the product/service). Otherwise supporting.
  if (fieldKey === "activity_log") {
    if (p.decisiveSessionProof === true || p.digitalAccessUsed === true) {
      return "strong";
    }
    return "supporting";
  }

  // ── supporting_documents ── (rubric #3: signed agreement / contract)
  // Strong only when the payload explicitly identifies the upload as a
  // signed contract or agreement. Otherwise supporting (manual screenshots
  // and uploaded documents without decisive content).
  if (fieldKey === "supporting_documents") {
    return p.signedContract === true ? "strong" : "supporting";
  }

  // ── policy fields ── (rubric #8)
  // Strong only when the customer explicitly accepted the policy at
  // checkout AND we have a timestamp linking the acceptance to the
  // order. Plain text disclosure stays supporting.
  if (
    fieldKey === "refund_policy" ||
    fieldKey === "shipping_policy" ||
    fieldKey === "cancellation_policy"
  ) {
    if (p.acceptedAtCheckout === true && p.acceptanceTimestamp) return "strong";
    return "supporting";
  }

  // Unknown conditional field — fall back to the default category.
  return spec.category;
}

/* ── Helpers ── */

/** Returns the spec for a field key, or null when unregistered. */
export function getCanonicalSpec(fieldKey: string): CanonicalSpec | null {
  return CANONICAL_EVIDENCE[fieldKey] ?? null;
}

/** Resolves the effective category — short-circuits to the persisted
 *  cache when its `categoryVersion` matches; otherwise re-derives via
 *  `categorizeEvidenceField`. Plan §P2.4a. */
export function categoryFor(args: {
  fieldKey: string;
  payload: Record<string, unknown> | null | undefined;
  cached?: PersistedCategory | null;
}): EvidenceCategory {
  const { fieldKey, payload, cached } = args;
  if (cached && cached.categoryVersion === CANONICAL_EVIDENCE_VERSION) {
    return cached.category;
  }
  return categorizeEvidenceField(fieldKey, payload);
}

/** True when adding this category to the case can affect overall
 *  strength. Always false for `supporting` and `invalid`. */
export function affectsStrength(category: EvidenceCategory): boolean {
  return category === "strong" || category === "moderate";
}

