/**
 * Invariant: nothing may bulk-delete the setup-owned rules rows except the
 * one canonical writer.
 *
 * WHY THIS EXISTS. `replacePackBasedAutomationRules` opened its write with
 *     .delete().eq("shop_id", …).like("name", "__dd_setup__%")
 * which removes `__dd_setup__:fallback:default` (the store-wide switch) AND
 * `__dd_setup__:safeguard:high_value` (the merchant's high-value threshold).
 * Once per-pack rules were collapsed into those two rows, every caller of
 * that helper became a way to silently turn off a merchant's auto-pilot and
 * wipe their threshold — including `POST /api/setup/automation` and the live
 * admin route `/api/admin/backfill-inquiry-pairs`.
 *
 * The helper is deleted. This test stops the pattern coming back: the only
 * places allowed to bulk-delete setup rules are the canonical writer and the
 * SQL migrations that own the schema.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { resolve, join, relative } from "path";

const ROOT = resolve(__dirname, "../..");

/** Source trees a merchant request can reach. */
const SCANNED = ["app", "lib", "components"];

/**
 * The single canonical writer. It delegates to the `write_store_automation`
 * RPC, which does the delete+insert atomically under a row lock.
 */
const ALLOWED = new Set(["lib/rules/storeAutomation.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SCANNED.flatMap((d) => {
  try {
    return walk(resolve(ROOT, d));
  } catch {
    return [];
  }
});

describe("no destructive bulk deletes of setup-owned rules", () => {
  it("scans a non-trivial number of source files", () => {
    // Guard the guard: a broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(200);
  });

  it("only the canonical writer may prefix-delete __dd_setup__ rules", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) continue;

      const src = readFileSync(file, "utf8");
      // A `.delete()` anywhere in the same file as a `__dd_setup__` prefix
      // match is the shape that caused the incident.
      const deletesRules = /\.delete\s*\(/.test(src);
      const matchesSetupPrefix =
        /["'`]__dd_setup__%?["'`]/.test(src) ||
        /\$\{SETUP_RULE_PREFIX\}%/.test(src) ||
        /left\(\s*name\s*,\s*12\s*\)/.test(src);

      if (deletesRules && matchesSetupPrefix) offenders.push(rel);
    }

    expect(
      offenders,
      `These files bulk-delete setup-owned rules. Only lib/rules/storeAutomation.ts ` +
        `may do that (via the write_store_automation RPC) — a prefix delete removes ` +
        `the store-wide switch AND the merchant's high-value safeguard.`,
    ).toEqual([]);
  });

  it("the deleted destructive helpers have not been reintroduced", () => {
    for (const gone of [
      "lib/rules/replacePackAutomationRules.ts",
      "lib/rules/packHandlingAutomation.ts",
      "app/api/setup/coverage-rules/route.ts",
    ]) {
      const present = files.some(
        (f) => relative(ROOT, f).replace(/\\/g, "/") === gone,
      );
      expect(present, `${gone} was deleted for destroying canonical rules rows`).toBe(
        false,
      );
    }
  });

  it("POST /api/setup/automation stays deleted (GET is read-only)", () => {
    const route = readFileSync(
      resolve(ROOT, "app/api/setup/automation/route.ts"),
      "utf8",
    );
    expect(route).not.toMatch(/export\s+async\s+function\s+POST/);
    expect(route).toMatch(/export\s+async\s+function\s+GET/);
  });
});
