import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";

/**
 * `shop_settings.auto_save_enabled` has exactly ONE writer:
 * `writeStoreAutomation` (lib/rules/storeAutomation.ts), which mirrors it from
 * the store-wide switch.
 *
 * Until 2026-07-28 there was a second one. `/app/settings` rendered an
 * "Auto-save evidence to Shopify" checkbox that PATCHed
 * `/api/automation/settings`, whose allow-list accepted the field and wrote
 * `shop_settings` directly. A merchant could therefore switch the field off
 * while `/app/rules` still displayed "Auto-pilot": the switch said automate,
 * the gate silently blocked every save, and nothing on screen revealed which
 * control had won.
 *
 * `storeAutomation.ts` has warned about this in prose since it was written
 * ("DO NOT add a second surface that writes either of these"). Prose does not
 * fail a build. This does.
 *
 * If you need to change the store-wide mode, call `writeStoreAutomation` —
 * or PUT /api/automation/store, which is the same path.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "lib", "components"];
const EXTENSIONS = [".ts", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage"]);

/** The one legitimate writer, plus the settings plumbing it flows through. */
const ALLOWED_WRITERS = new Set(
  [
    "lib/rules/storeAutomation.ts",
    // Generic `shop_settings` update helper — takes whatever the caller passes;
    // storeAutomation.ts is what passes this field.
    "lib/automation/settings.ts",
  ].map((p) => p.split("/").join(sep)),
);

/**
 * Scanned for WRITES, so two kinds of file are out of scope:
 *   - tests, which build settings objects as inputs to pure functions
 *   - `lib/demo/**`, whose shim serves a canned GET response (a read shape)
 * Neither can reach `shop_settings`.
 */
function isOutOfScope(rel: string): boolean {
  return (
    rel.includes(`__tests__${sep}`) ||
    rel.endsWith(".test.ts") ||
    rel.endsWith(".test.tsx") ||
    rel.startsWith(`lib${sep}demo${sep}`)
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

describe("auto_save_enabled has a single writer", () => {
  it("no file outside storeAutomation.ts assigns or submits the field", () => {
    const offenders: string[] = [];

    // An assignment (`auto_save_enabled: <value>`) or a React state update —
    // as opposed to a read (`a.auto_save_enabled`) or a mention in a comment.
    const writePattern = /(?<![.\w])auto_save_enabled\s*:/;

    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(REPO_ROOT, dir))) {
        const rel = relative(REPO_ROOT, file);
        if (ALLOWED_WRITERS.has(rel) || isOutOfScope(rel)) continue;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
            // A type declaration (`auto_save_enabled: boolean;`) is a shape,
            // not a write.
            if (/auto_save_enabled\s*:\s*(boolean|number|string)/.test(code)) return;
            if (writePattern.test(code)) {
              offenders.push(`${rel}:${index + 1} → ${line.trim()}`);
            }
          });
      }
    }

    expect(offenders).toEqual([]);
  });

  it("the automation-settings route does not accept the field", () => {
    const source = readFileSync(
      join(REPO_ROOT, "app", "api", "automation", "settings", "route.ts"),
      "utf8",
    );
    const allowList = source.match(/const allowed = \[([\s\S]*?)\]/);
    expect(allowList, "couldn't find the allow-list").toBeTruthy();
    expect(allowList![1]).not.toContain("auto_save_enabled");
    // The fields that genuinely belong to this route stay writable.
    expect(allowList![1]).toContain("auto_save_min_score");
    expect(allowList![1]).toContain("enforce_no_blockers");
  });
});
