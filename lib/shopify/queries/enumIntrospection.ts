/**
 * Shopify GraphQL introspection queries.
 *
 * Used by the reason-enum drift check cron to detect when Shopify
 * adds or removes values on ShopifyPaymentsDisputeReason before a
 * merchant receives a dispute with the new value.
 */

export const REASON_ENUM_INTROSPECTION_QUERY = `
  query ReasonEnumIntrospection {
    __type(name: "ShopifyPaymentsDisputeReason") {
      name
      enumValues {
        name
      }
    }
  }
`;

export interface ReasonEnumIntrospectionResponse {
  __type: {
    name: string;
    enumValues: Array<{ name: string }>;
  } | null;
}
