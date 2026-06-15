/**
 * `shop.shopPolicies` query — the merchant's *published* legal policies
 * (the footer links: Refund policy, Shipping, Privacy, Terms of
 * service, Cancellations, Contact).
 *
 * This is the source of truth for policy evidence. A policy only has
 * weight with a bank if it was published and visible to the customer,
 * with a live URL we can cite — Shopify's refundPolicyDisclosure
 * evidence asks "where did the customer see this policy?". The live
 * `url` on each ShopPolicy answers that. Templates the merchant merely
 * picked from our library have no such URL and are never cited.
 *
 * Schema notes (Admin GraphQL 2026-01):
 *   - `Shop.shopPolicies: [ShopPolicy!]!` — every legal policy on the
 *     shop. No arguments; returns the full set.
 *   - `ShopPolicy` fields: id, type (ShopPolicyType!), title, body
 *     (HTML!), url (URL!), createdAt, updatedAt. `body` is HTML — strip
 *     to text before storing in policy_snapshots.extracted_text.
 *   - `ShopPolicyType` enum (verified 2026-01): CONTACT_INFORMATION,
 *     LEGAL_NOTICE, PRIVACY_POLICY, REFUND_POLICY, SHIPPING_POLICY,
 *     SUBSCRIPTION_POLICY, TERMS_OF_SALE, TERMS_OF_SERVICE.
 */

export const SHOP_POLICIES_QUERY = /* GraphQL */ `
  query ShopPolicies {
    shop {
      shopPolicies {
        id
        type
        title
        body
        url
        createdAt
        updatedAt
      }
    }
  }
`;

/** ShopPolicyType enum values (Admin GraphQL 2026-01). */
export type ShopPolicyType =
  | "CONTACT_INFORMATION"
  | "LEGAL_NOTICE"
  | "PRIVACY_POLICY"
  | "REFUND_POLICY"
  | "SHIPPING_POLICY"
  | "SUBSCRIPTION_POLICY"
  | "TERMS_OF_SALE"
  | "TERMS_OF_SERVICE";

export interface ShopPolicyNode {
  id: string;
  type: ShopPolicyType;
  title: string;
  /** HTML — strip to text before persisting. */
  body: string;
  /** Live storefront URL — the citable "where the customer saw it". */
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShopPoliciesResponse {
  shop: {
    shopPolicies: ShopPolicyNode[];
  } | null;
}

/** Our internal policy_snapshots.policy_type values. */
export type PolicySnapshotType =
  | "refunds"
  | "shipping"
  | "terms"
  | "privacy"
  | "contact"
  | "subscription";

/**
 * Map a Shopify ShopPolicyType to our internal policy_type. Returns
 * null for types we don't track (LEGAL_NOTICE, TERMS_OF_SALE) so the
 * caller can skip them rather than inventing a bucket.
 */
export function mapShopPolicyType(
  type: ShopPolicyType,
): PolicySnapshotType | null {
  switch (type) {
    case "REFUND_POLICY":
      return "refunds";
    case "SHIPPING_POLICY":
      return "shipping";
    case "TERMS_OF_SERVICE":
      return "terms";
    case "PRIVACY_POLICY":
      return "privacy";
    case "CONTACT_INFORMATION":
      return "contact";
    case "SUBSCRIPTION_POLICY":
      return "subscription";
    case "LEGAL_NOTICE":
    case "TERMS_OF_SALE":
      return null;
    default:
      return null;
  }
}
