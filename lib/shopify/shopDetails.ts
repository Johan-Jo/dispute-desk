import { loadSession } from "./sessionStorage";
import { makeAuthedRequest } from "./makeAuthedRequest";

export interface ShopDetails {
  name: string;
  email: string;
  phone: string;
  /** Full primary domain URL, e.g. https://example.com or https://example.myshopify.com */
  primaryDomain: string;
  address: {
    address1: string;
    address2: string;
    city: string;
    province: string;
    zip: string;
    country: string;
  };
}

// API 2026-01 removed `Shop.phone` and `Shop.billingAddress`. The
// address lives on `Shop.shopAddress` (a `ShopAddress` whose `phone`
// field replaces the old top-level one). Querying the dropped fields
// fails the whole request with `undefinedField`, so the activate step
// surfaced as "no email even though Shopify has one".
const SHOP_DETAILS_QUERY = `
  query ShopDetails {
    shop {
      name
      email
      contactEmail
      primaryDomain { url }
      shopAddress {
        address1
        address2
        city
        province
        zip
        country
        phone
      }
    }
  }
`;

interface ShopQueryData {
  shop: {
    name: string;
    email: string;
    contactEmail: string | null;
    primaryDomain: { url: string };
    shopAddress: {
      address1: string | null;
      address2: string | null;
      city: string | null;
      province: string | null;
      zip: string | null;
      country: string | null;
      phone: string | null;
    } | null;
  };
}

export async function fetchShopDetails(shopInternalId: string): Promise<ShopDetails | null> {
  // Pre-flight domain sanity check stays here so we can early-return
  // null without a Shopify roundtrip when the stored domain is bogus.
  const session = await loadSession(shopInternalId, "offline");
  if (!session) return null;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(session.shopDomain)) {
    console.warn("[shopDetails] invalid shop domain on session", {
      shopInternalId,
      shopDomain: session.shopDomain,
    });
    return null;
  }

  const result = await makeAuthedRequest<ShopQueryData>({
    shopId: shopInternalId,
    query: SHOP_DETAILS_QUERY,
  });

  const shop = result.data?.shop;
  if (!shop) {
    // Log so the next regression like the 2026-01 phone/billingAddress
    // drop doesn't take a round trip through the merchant dashboard to
    // diagnose. `errors` carries the `undefinedField` shape Shopify
    // returns on schema drift.
    console.warn("[shopDetails] empty data.shop from Shopify Admin", {
      shopInternalId,
      errors: result.errors?.map((e) => e.message),
    });
    return null;
  }

  const addr = shop.shopAddress;

  return {
    name: shop.name,
    email: shop.contactEmail ?? shop.email,
    phone: addr?.phone ?? "",
    primaryDomain: shop.primaryDomain.url,
    address: {
      address1: addr?.address1 ?? "",
      address2: addr?.address2 ?? "",
      city: addr?.city ?? "",
      province: addr?.province ?? "",
      zip: addr?.zip ?? "",
      country: addr?.country ?? "",
    },
  };
}

/** Replace known template placeholders with real shop data. */
export function applyShopPlaceholders(content: string, shop: ShopDetails): string {
  const addressParts = [
    shop.address.address1,
    shop.address.address2,
    shop.address.city,
    shop.address.province,
    shop.address.zip,
    shop.address.country,
  ].filter(Boolean);
  const addressFormatted = addressParts.length > 0
    ? addressParts.join(", ")
    : null;

  const jurisdiction = [shop.address.province, shop.address.country]
    .filter(Boolean)
    .join(", ");

  function fill(placeholder: string, value: string | null): string {
    if (!value) return placeholder;
    return value;
  }

  return content
    .replace(/\[Store Name\]/g, fill("[Store Name]", shop.name))
    .replace(/\[Legal Company Name\]/g, fill("[Legal Company Name]", shop.name))
    .replace(/\[Support Email\]/g, fill("[Support Email]", shop.email))
    .replace(/\[Privacy Email \/ Support Email\]/g, fill("[Privacy Email / Support Email]", shop.email))
    .replace(/\[Privacy Email\]/g, fill("[Privacy Email]", shop.email))
    .replace(/\[Phone Number, if applicable\]/g, fill("[Phone Number, if applicable]", shop.phone || null))
    .replace(/\[Phone Number\]/g, fill("[Phone Number]", shop.phone || null))
    .replace(/\[Registered Address\]/g, fill("[Registered Address]", addressFormatted))
    .replace(/\[Business Address\]/g, fill("[Business Address]", addressFormatted))
    .replace(/\[Country \/ State\]/g, fill("[Country / State]", jurisdiction || null))
    .replace(/\[Jurisdiction\]/g, fill("[Jurisdiction]", jurisdiction || null));
}
