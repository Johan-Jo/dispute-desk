/**
 * Shared types for the Liability-Shift Engine (LSE-1 — CE 3.0 qualification).
 *
 * See docs/epics/EPIC-LSE-1-qualification-engine.md.
 */

import type { CardNetwork } from "@/lib/disputes/reasonCodeCatalog";

export type CE30Verdict =
  | "qualifies"
  | "qualifies_network_prequalified"
  | "qualifies_via_initial_billing"
  | "partial"
  | "does_not_qualify"
  | "not_applicable";

export type CE30Branch =
  | "auto_qualified"
  | "initial_billing"
  | "standard"
  | "none";

export type MatchPoint = "ip" | "device" | "shipping" | "account";

export type Confidence = "high" | "medium" | "low";

export type AutoQualificationVia =
  | "visa_secure"
  | "visa_data_only"
  | "merchant_confirmed";

/** Shape of an order row as the qualification engine consumes it. */
export interface QualificationOrder {
  shopifyOrderId: string;
  createdAt: string; // ISO-8601
  customerId: string | null;
  customerEmail: string | null;
  cardNetwork: CardNetwork | null;
  ipAddress: string | null;
  deviceFingerprint: string | null;
  shippingAddress: ShippingAddressShape | null;
  /** Set when the order is a recurring/MIT billing. */
  subscriptionMarker: string | null;
  totalAmount: number;
  totalRefunded: number;
  disputed: boolean;
  /** True for low-value validation charges ($0 / $1) that CE 3.0 excludes. */
  isValidationCharge: boolean;
  /** Visa Secure / Visa Data Only state from the existing 3DS source. */
  threeDSecure: {
    authenticated: boolean;
    dataOnly: boolean;
    /** True when the merchant manually confirmed 3DS via the dashboard. */
    merchantConfirmed: boolean;
  } | null;
  /** True when the disputed order is the *original* signup transaction of a subscription. */
  isInitialSubscriptionBilling?: boolean;
}

export interface ShippingAddressShape {
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  country: string | null;
  countryCode: string | null;
  zip: string | null;
}

export interface CE30Input {
  disputed: QualificationOrder;
  /** Disputed order's resolved network reason code (from LSE-0). */
  networkReasonCode: string | null;
  /**
   * Available prior orders for matching. The standard branch filters
   * these to the 120–365 day window. The initial-billing branch picks
   * the matching subscription billing record.
   */
  priors: QualificationOrder[];
  /**
   * The initial subscription billing transaction for this customer's
   * subscription, when the disputed order is a recurring bill. Caller
   * resolves this separately (Shopify orders query filtered to the
   * earliest non-disputed bill for the subscription marker).
   */
  initialSubscriptionBilling?: QualificationOrder | null;
  /**
   * Disputed transaction date used for the April-2026 fee gate.
   * Defaults to disputed.createdAt.
   */
  disputedAt?: string;
}

export interface CE30Result {
  verdict: CE30Verdict;
  branch: CE30Branch;
  program: "ce_30" | "none";
  matchPoints: MatchPoint[];
  hasAnchor: boolean;
  qualifyingPriors: string[];
  autoQualificationVia: AutoQualificationVia | null;
  autoQualificationFeeApplies: boolean;
  confidence: Confidence | null;
  confidenceReasons: string[];
  missingEvidence: string[];
  /** Human-readable summary (English; UI uses i18n keys instead). */
  summary: string;
}

/** Visa effective date for the auto-qualification fee. */
export const AUTO_QUALIFICATION_FEE_EFFECTIVE_DATE = "2026-04-17";

export const CE30_PRIOR_MIN_DAYS = 120;
export const CE30_PRIOR_MAX_DAYS = 365;

/* ── FPT (Mastercard) shared types ── */

/** ISO 3166-1 alpha-2 country code (subset relevant to FPT regions). */
export type ISO3166CountryCode =
  | "US" | "CA" | "BR" | "MX" | "AR" | "CL" | "CO" | "PE" | "UY" | "EC"
  | "DO" | "JM" | "TT" | "BB"
  | "AU" | "NZ" | "SG" | "HK" | "JP" | "KR" | "PH" | "MY" | "TH" | "ID" | "VN" | "IN"
  | "GB" | "DE" | "FR" | "ES" | "IT" | "NL" | "BE" | "AT" | "PL" | "SE"; // EU subset for "not-yet" diagnostics

export type FPTVerdict = "ready" | "partial" | "not_ready" | "not_applicable";

export type FPTCategory = "device" | "delivery" | "identity";

export interface FPTCategoryScore {
  category: FPTCategory;
  /** 0.0 to 1.0. */
  score: number;
  /** Machine codes describing what fed this score. */
  signals: string[];
}

export interface FPTResult {
  verdict: FPTVerdict;
  program: "fpt" | "none";
  categories: Record<FPTCategory, FPTCategoryScore>;
  /** Sum of category scores, 0–3. ≥2.0 + all-positive is the v1 ready threshold. */
  totalScore: number;
  /** Reason code matched (4837 or 4863) or null when not applicable. */
  reasonCode: string | null;
  regionEligible: boolean;
  confidence: Confidence | null;
  confidenceReasons: string[];
  missingEvidence: string[];
  summary: string;
}
