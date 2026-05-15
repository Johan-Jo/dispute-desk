/**
 * Schema-drift regression guard.
 *
 * Every time Shopify removes or renames a field in a new Admin API
 * version, every production query that references it fails wholesale
 * with `Field 'X' doesn't exist on type 'Y'`. Shopify silently nulls
 * `data.node` (or the parent type) when this happens, which cascades
 * into downstream code that reports "couldn't load order data" without
 * the underlying schema error surfacing in user-facing UI.
 *
 * Standard unit tests don't catch this because they mock the Shopify
 * GraphQL response — every fixture is a valid object, and there's no
 * round-trip through Shopify's parser. This test compensates by
 * maintaining an explicit deny-list of fields known to have been
 * removed in past API versions and asserting that no production query
 * string re-introduces them.
 *
 * When Shopify removes a new field in production:
 *   1. Add an entry to FORBIDDEN_GLOBAL or FORBIDDEN_BY_PARENT below.
 *   2. Remove the field from every query and downstream type/consumer.
 *   3. Run this test and confirm it now passes.
 *
 * This is a deny-list, NOT an allow-list — it does not catch fields
 * that were renamed (Shopify's frequent pattern) unless the old name
 * is added here. The medium-term fix is an integration test that runs
 * each production query against a live Shopify test shop and inspects
 * the response's `errors[]` for `undefinedField`; see
 * `docs/technical.md` § Schema drift fix.
 */

import { describe, it, expect } from "vitest";

import { ORDER_DETAIL_QUERY } from "../orders";
import { CUSTOMER_ORDERS_FOR_CE30_QUERY } from "../customerOrdersForCE30";
import { ORDERS_FOR_BACKFILL_QUERY } from "../ordersForBackfill";
import { ORDERS_FOR_SNAPSHOT_QUERY } from "../ordersForSnapshot";
import { APP_CHARGE_STATUS_QUERY } from "../appChargeStatus";
import {
  DISPUTE_LIST_QUERY,
  DISPUTE_DETAIL_QUERY,
  DISPUTE_PROFILE_QUERY,
} from "../disputes";
import { APP_SUBSCRIPTION_CREATE_MUTATION } from "../../mutations/appSubscriptionCreate";
import { DISPUTE_EVIDENCE_UPDATE_MUTATION } from "../../mutations/disputeEvidenceUpdate";

/** Every production GraphQL string sent to Shopify Admin. Keep in sync
 *  with `lib/shopify/queries/` + `lib/shopify/mutations/`. */
const PROD_GRAPHQL: Record<string, string> = {
  ORDER_DETAIL_QUERY,
  CUSTOMER_ORDERS_FOR_CE30_QUERY,
  ORDERS_FOR_BACKFILL_QUERY,
  ORDERS_FOR_SNAPSHOT_QUERY,
  APP_CHARGE_STATUS_QUERY,
  DISPUTE_LIST_QUERY,
  DISPUTE_DETAIL_QUERY,
  DISPUTE_PROFILE_QUERY,
  APP_SUBSCRIPTION_CREATE_MUTATION,
  DISPUTE_EVIDENCE_UPDATE_MUTATION,
};

/** Strip line and block comments so an explanatory `# NOTE: …` mention
 *  of a removed field doesn't trip the guard. Replicated rather than
 *  imported so the test stays dependency-free. */
function stripGraphQLComments(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      const hash = line.indexOf("#");
      return hash === -1 ? line : line.slice(0, hash);
    })
    .join("\n");
}

interface ForbiddenGlobal {
  field: string;
  selector: string;
  removedIn: string;
  incident: string;
  remediation: string;
}

/** Fields removed from the schema entirely — must not appear anywhere
 *  in any production GraphQL string, regardless of parent type. */
const FORBIDDEN_GLOBAL: ForbiddenGlobal[] = [
  {
    field: "cartToken",
    selector: "Order.cartToken",
    removedIn: "Admin API 2026-01",
    incident: "2026-05-15",
    remediation:
      "Persist cart_token from the orders/create webhook payload (REST shape still includes it) or from the storefront checkout extension. Match LSE-4 sessions by shopify_order_id instead.",
  },
  {
    field: "riskAssessments",
    selector: "Order.riskAssessments",
    removedIn: "Admin API 2026-01",
    incident: "2026-04-20",
    remediation:
      "Replaced by Order.risk { assessments { ... } } — see ordersForBackfill.ts for the working shape.",
  },
];

interface ForbiddenByParent {
  parent: string;
  field: string;
  selector: string;
  removedIn: string;
  incident: string;
  remediation: string;
}

/** Field-in-context bans. The field name itself may still be valid
 *  elsewhere (e.g. `metafields` on Order is fine; on Fulfillment is
 *  not), so a global ban would produce false positives. */
const FORBIDDEN_BY_PARENT: ForbiddenByParent[] = [
  {
    parent: "fulfillments",
    field: "metafields",
    selector: "Fulfillment.metafields",
    removedIn: "Admin API 2026-01",
    incident: "2026-05-15",
    remediation:
      "Tracking-app metafields are read from Order.metafields instead; lib/packs/sources/fulfillmentSource.ts already null-tolerates the per-fulfillment path.",
  },
];

/**
 * Walk a GraphQL string and, for every occurrence of `field`, return
 * the name of its immediate enclosing block. Uses brace-depth tracking
 * to find the parent block's opening brace, then a small regex to
 * extract the field-name token just before it.
 *
 * Limitation: only resolves the IMMEDIATE parent — does not walk up
 * the full path. For most schema-drift cases that's enough, because
 * Shopify removes fields at a specific type, not in deeper transitive
 * positions.
 */
function findParentFieldsOf(query: string, field: string): string[] {
  const parents: string[] = [];
  const needle = new RegExp(`\\b${field}\\s*[({]`, "g");
  let match: RegExpExecArray | null;
  while ((match = needle.exec(query)) !== null) {
    const at = match.index;

    let depth = 0;
    let parentBraceIdx = -1;
    for (let j = at - 1; j >= 0; j--) {
      const ch = query[j];
      if (ch === "}") depth++;
      else if (ch === "{") {
        if (depth === 0) {
          parentBraceIdx = j;
          break;
        }
        depth--;
      }
    }

    if (parentBraceIdx === -1) continue;

    const before = query.slice(Math.max(0, parentBraceIdx - 160), parentBraceIdx);
    const trailing = before.match(/(\w+)\s*(?:\([^)]*\))?\s*$/);
    if (trailing) parents.push(trailing[1]);
  }
  return parents;
}

describe("Shopify GraphQL queries — schema-drift guard", () => {
  describe("globally removed fields", () => {
    for (const banned of FORBIDDEN_GLOBAL) {
      for (const [name, body] of Object.entries(PROD_GRAPHQL)) {
        it(`${name} does not reference ${banned.selector} (removed ${banned.removedIn}, incident ${banned.incident})`, () => {
          const cleaned = stripGraphQLComments(body);
          const re = new RegExp(`\\b${banned.field}\\b`);
          if (re.test(cleaned)) {
            throw new Error(
              `${name} references ${banned.selector}.\n` +
                `Removed: ${banned.removedIn}.\n` +
                `Incident: ${banned.incident}.\n` +
                `Remediation: ${banned.remediation}`,
            );
          }
          expect(re.test(cleaned)).toBe(false);
        });
      }
    }
  });

  describe("fields removed from a specific parent type", () => {
    for (const banned of FORBIDDEN_BY_PARENT) {
      for (const [name, body] of Object.entries(PROD_GRAPHQL)) {
        it(`${name} does not select ${banned.selector} (removed ${banned.removedIn}, incident ${banned.incident})`, () => {
          const cleaned = stripGraphQLComments(body);
          const parents = findParentFieldsOf(cleaned, banned.field);
          if (parents.includes(banned.parent)) {
            throw new Error(
              `${name} selects \`${banned.field}\` under \`${banned.parent}\` — i.e. ${banned.selector}.\n` +
                `Removed: ${banned.removedIn}.\n` +
                `Incident: ${banned.incident}.\n` +
                `Remediation: ${banned.remediation}`,
            );
          }
          expect(parents.includes(banned.parent)).toBe(false);
        });
      }
    }
  });
});
