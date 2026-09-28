/**
 * Product-listing evidence for a disputed order (not-as-described plan PR 3).
 *
 * Per line item: the product's current listing (title, description, up to
 * three images, public URL, last update) and the purchased variant (options,
 * variant image). This is the listing AS IT IS NOW — the letter captions it
 * "as published in the store, retrieved {date}" and never claims it is what
 * the customer saw at checkout (plan §1, C2).
 *
 * Requires `read_products` (granted on every installed shop, PR 0 §1).
 */
export const PRODUCT_EVIDENCE_QUERY = `query ProductEvidence($id: ID!, $after: String) {
  order(id: $id) {
    id
    lineItems(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        quantity
        requiresShipping
        originalTotalSet { shopMoney { amount currencyCode } }
        customAttributes { key value }
        product {
          id
          title
          description
          descriptionHtml
          updatedAt
          onlineStoreUrl
          media(first: 3) {
            nodes {
              ... on MediaImage { id image { url altText } }
            }
          }
        }
        variant {
          id
          title
          selectedOptions { name value }
          image { url altText }
        }
      }
    }
  }
}`;

export interface ProductEvidenceImage {
  url: string;
  altText: string | null;
}

export interface ProductEvidenceLineItem {
  id: string;
  name: string | null;
  quantity: number | null;
  /** False for shipping insurance, gift cards, services — not merchandise. */
  requiresShipping: boolean | null;
  originalTotalSet: { shopMoney: { amount: string; currencyCode: string } } | null;
  customAttributes: Array<{ key: string; value: string | null }> | null;
  product: {
    id: string;
    title: string | null;
    description: string | null;
    descriptionHtml: string | null;
    updatedAt: string | null;
    onlineStoreUrl: string | null;
    media: { nodes: Array<{ id?: string; image?: ProductEvidenceImage | null }> } | null;
  } | null;
  variant: {
    id: string;
    title: string | null;
    selectedOptions: Array<{ name: string; value: string }> | null;
    image: ProductEvidenceImage | null;
  } | null;
}

export interface ProductEvidenceResult {
  order: {
    id: string;
    lineItems: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: ProductEvidenceLineItem[];
    };
  } | null;
}
