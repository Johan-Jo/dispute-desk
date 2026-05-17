import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";

// Whitelist of evidence-capability keys allowed in pack_template_items.collector_key.
// Adding a new key here must be paired with a real collector that produces the
// evidence, and the page.tsx COLLECTOR_KEY_SOURCE map must learn about it.
// See docs/technical.md "Template → collector mapping".
const ALLOWED_COLLECTOR_KEYS = new Set([
  "order_confirmation",
  "payment_authentication",
  "tds_authentication",
  "fraud_risk_screening",
  "ip_location_check",
  "billing_address_match",
  "customer_account_info",
  "customer_communication",
  "shipping_tracking",
  "delivery_proof",
  "refund_record",
  "refund_policy",
  "shipping_policy",
  "cancellation_policy",
]);

// Scrape every collector_key literal out of the migrations directory.
// Matches single-quoted SQL literals only — NULL collector_keys (merchant
// upload rows) and the column definition itself are ignored.
function collectCollectorKeyLiterals(): { value: string; file: string }[] {
  const dir = resolve(__dirname, "../../supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const found: { value: string; file: string }[] = [];

  for (const file of files) {
    const sql = readFileSync(resolve(dir, file), "utf8");
    if (!sql.includes("collector_key")) continue;

    // Match: SET collector_key = 'value' | collector_key = 'value' | ,'value', in a VALUES tuple
    // We grab anything that looks like an assignment to collector_key OR an inline literal
    // in a VALUES row where collector_key is the last/only positional value.
    // Simpler approach: pull every string literal that follows the word collector_key
    // (in SET ... = '...') AND every literal that appears in INSERT ... collector_key)
    // VALUES tuples. To keep this robust we capture both:
    //   a) collector_key = 'foo'
    //   b) INSERT ... collector_key) ... VALUES (..., 'foo'[,)] — captured by walking
    //      each VALUES tuple after a collector_key column reference.
    for (const m of sql.matchAll(/collector_key\s*=\s*'([^']+)'/g)) {
      found.push({ value: m[1], file });
    }

    // Inline VALUES tuples: locate every INSERT ... pack_template_items(...) ...
    // VALUES block where collector_key is the last named column, then pull the
    // final string literal of each tuple.
    const insertRe =
      /INSERT INTO pack_template_items[^;]*?collector_key\s*\)[^;]*?VALUES([\s\S]*?);/gi;
    for (const ins of sql.matchAll(insertRe)) {
      const valuesBlock = ins[1];
      // Each tuple ends with ", '<value>')," or ", NULL)," — capture both.
      for (const tup of valuesBlock.matchAll(/,\s*'([^']+)'\)/g)) {
        found.push({ value: tup[1], file });
      }
    }
  }
  return found;
}

describe("pack_template_items.collector_key whitelist", () => {
  const literals = collectCollectorKeyLiterals();

  it("scans found at least one collector_key literal across migrations", () => {
    // Sanity guard so a future regex break does not silently make the assertion vacuous.
    expect(literals.length).toBeGreaterThan(10);
  });

  it("every non-null collector_key literal is in the allowed whitelist", () => {
    const bad = literals.filter((l) => !ALLOWED_COLLECTOR_KEYS.has(l.value));
    if (bad.length > 0) {
      const detail = bad
        .map((b) => `  - "${b.value}" in ${b.file}`)
        .join("\n");
      throw new Error(
        `Found ${bad.length} collector_key literal(s) not in the whitelist:\n${detail}\n\nAdd them to ALLOWED_COLLECTOR_KEYS only when a real collector exists, and update COLLECTOR_KEY_SOURCE in app/(embedded)/app/packs/[packId]/page.tsx.`,
      );
    }
    expect(bad).toEqual([]);
  });
});
