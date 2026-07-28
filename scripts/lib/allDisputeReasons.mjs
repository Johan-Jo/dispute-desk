/**
 * Single source of truth for node scripts that need the Shopify dispute
 * reason list.
 *
 * `lib/rules/disputeReasons.ts` owns `ALL_DISPUTE_REASONS`. Plain-node
 * scripts can't import TypeScript, so they used to keep their own copy —
 * and on 2026-07-28 that copy was found carrying `SUBSCRIPTION_CANCELED`
 * (single L), a value Shopify's `ShopifyPaymentsDisputeReason` enum has
 * never contained. A drift checker that hardcodes the thing it checks
 * cannot report its own drift.
 *
 * Parsing the TS file keeps exactly one list.
 * Pinned by `lib/rules/__tests__/shopifyReasonEnum.test.ts`.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DISPUTE_REASONS_SOURCE = resolve(
  __dirname,
  "..",
  "..",
  "lib",
  "rules",
  "disputeReasons.ts",
);

export function readAllDisputeReasons(sourcePath = DISPUTE_REASONS_SOURCE) {
  const src = readFileSync(sourcePath, "utf8");
  const block = src.match(
    /export const ALL_DISPUTE_REASONS = \[([\s\S]*?)\] as const;/,
  );
  if (!block) {
    throw new Error(
      `[allDisputeReasons] could not parse ALL_DISPUTE_REASONS from ${sourcePath}`,
    );
  }
  const values = [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  if (values.length === 0) {
    throw new Error("[allDisputeReasons] parsed an empty list");
  }
  return values;
}
