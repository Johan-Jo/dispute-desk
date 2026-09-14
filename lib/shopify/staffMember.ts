/**
 * Resolve a Shopify staff member's display name/email from the numeric
 * user id carried in the embedded-app session token (`sub` claim,
 * verified by lib/shopify/sessionToken.ts). Used only to enrich the
 * internal admin "last login" column — never a data dependency for any
 * merchant-facing flow.
 *
 * Requires the `read_users` scope. Shops that installed before that
 * scope was added will get `undefinedField`/access-denied errors from
 * Shopify until they re-consent (next OAuth/token-exchange cycle) — this
 * degrades to null, same pattern as persistShopCurrency.ts.
 */

import { makeAuthedRequest } from "./makeAuthedRequest";

export interface StaffMemberInfo {
  name: string | null;
  email: string | null;
}

const STAFF_MEMBER_QUERY = `
  query StaffMemberById($id: ID!) {
    staffMember(id: $id) {
      name
      email
    }
  }
`;

interface StaffMemberQueryData {
  staffMember: {
    name: string | null;
    email: string | null;
  } | null;
}

/**
 * @param shopInternalId - shops.id, used to load the offline session/token.
 * @param shopifyUserId - numeric Shopify staff user id (session token `sub`
 *   claim), NOT prefixed with the gid:// URI form — this builds it.
 */
export async function fetchStaffMember(
  shopInternalId: string,
  shopifyUserId: string,
): Promise<StaffMemberInfo | null> {
  try {
    const result = await makeAuthedRequest<StaffMemberQueryData>({
      shopId: shopInternalId,
      query: STAFF_MEMBER_QUERY,
      variables: { id: `gid://shopify/StaffMember/${shopifyUserId}` },
    });

    const staffMember = result.data?.staffMember;
    if (!staffMember) {
      if (result.errors?.length) {
        console.warn("[staffMember] query error", {
          shopInternalId,
          errors: result.errors.map((e) => e.message),
        });
      }
      return null;
    }

    return {
      name: staffMember.name?.trim() || null,
      email: staffMember.email?.trim() || null,
    };
  } catch (err) {
    console.warn(
      "[staffMember] fetch threw",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
