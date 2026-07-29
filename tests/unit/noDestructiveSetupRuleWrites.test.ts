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
 * The helper is deleted. This test stops the pattern coming back.
 *
 * UPDATED 2026-07-28 — this file had become a trap in two ways:
 *
 *  1. Its comment described a `write_store_automation` RPC doing the
 *     delete+insert atomically under a row lock. **There is no such RPC.** The
 *     migrations that would have created it were in closed PR #443 and never
 *     merged; the test passed anyway because it only greps for string patterns
 *     and never asserted the function exists. Documentation that lies is worse
 *     than none, so the claim is gone rather than softened.
 *  2. Now that `storeAutomation.ts` deletes by an explicit name list, it no
 *     longer contains a `${SETUP_RULE_PREFIX}%` pattern — so it stops matching
 *     the scan, the allow-list entry goes dead, and the test would keep
 *     passing while silently guarding nothing. The allow-list is therefore
 *     EMPTY (nobody may prefix-delete, canonical writer included) and a
 *     positive assertion pins the writer's delete shape directly.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { resolve, join, relative } from "path";

const ROOT = resolve(__dirname, "../..");

/** Source trees a merchant request can reach. */
const SCANNED = ["app", "lib", "components"];

/**
 * Empty on purpose. `lib/rules/storeAutomation.ts` used to be exempt because
 * it was the one place a `__dd_setup__:%` prefix delete was legitimate. It
 * isn't any more: a prefix delete would take the merchant's per-group
 * overrides with it. Every delete now names exactly what it removes.
 */
const ALLOWED = new Set<string>([]);

const CANONICAL_WRITER = "lib/rules/storeAutomation.ts";

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
      `These files bulk-delete setup-owned rules by prefix. Nothing may do that — ` +
        `a prefix delete removes the store-wide switch, the merchant's high-value ` +
        `safeguard AND every per-group override. Delete by explicit name instead ` +
        `(see SETUP_OWNED_RULE_NAMES in ${CANONICAL_WRITER}).`,
    ).toEqual([]);
  });

  it("the canonical writer deletes by name, never by LIKE", () => {
    // The positive half. Without it, narrowing the delete would make the scan
    // above stop matching this file, and the guard would quietly evaporate.
    const src = readFileSync(resolve(ROOT, CANONICAL_WRITER), "utf8");
    const code = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
      .join("\n");

    expect(code).not.toMatch(/\.like\s*\(/);
    expect(code).toMatch(/\.delete\s*\(\s*\)/);
    expect(code).toMatch(/\.in\s*\(\s*["']name["']\s*,\s*SETUP_OWNED_RULE_NAMES/);
  });

  it("the writer's delete list covers every group name", () => {
    // A group name missing from the list leaves an orphan row routing disputes
    // through a control the UI no longer shows.
    const src = readFileSync(resolve(ROOT, CANONICAL_WRITER), "utf8");
    expect(src).toMatch(/ALL_GROUP_RULE_NAMES/);
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
