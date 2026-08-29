/**
 * CI invariant: every code path that CREATES a `shops` row must run the
 * once-per-new-merchant side effects via `onNewShopCreated`.
 *
 * ## Why this test exists
 *
 * The admin "new merchant installed" alert has gone missing three times, each
 * time because a NEW install path was added without the side effects the older
 * path carried — the fix was applied to the instance, never to the class:
 *
 *   - 2026-05-31 (`6mjjvm-tc`): alert gated on `source === "portal"`; embedded
 *     App Store installs skipped it.
 *   - 2026-07 (`daniel-store` / `blume-box` / `cay-collective`): alert fired
 *     un-awaited and lost the race against Vercel freezing the instance.
 *   - 2026-08-29 (`6a8848-dd`, `isj-153` on 08-26): Session Token Exchange
 *     became a second shop-creating path and inserted rows silently. All three
 *     earlier fixes lived in the OAuth callback, so none of them applied.
 *
 * This test fails the build when a fourth path appears: it greps the repo for
 * `.insert(...)` calls into `shops` and asserts each containing file also
 * references `onNewShopCreated`. A new install path is then a red test, not a
 * merchant you never hear about.
 *
 * If you are adding a legitimate new install path: import and call
 * `onNewShopCreated` after the offline session is stored (so the alert carries
 * store name + owner email) and this test goes green on its own.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SEARCH_ROOTS = ["app", "lib"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "__tests__",
  "tests",
]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Matches a Supabase insert into the `shops` table, tolerating the formatting
 * both current call sites use:
 *
 *   .from("shops")            .from("shops")
 *     .insert({ ... })          .select("id")
 *                               .insert({ ... })
 *
 * Only `.` -chained calls may appear between `.from("shops")` and `.insert(`,
 * so the match cannot run past the end of the statement into an unrelated
 * `.from("audit_events").insert(...)` later in the file — that looser form
 * produced false positives on the orders-reconciliation cron and the GDPR
 * customers-data-request webhook, neither of which creates a shop.
 */
const SHOPS_INSERT =
  /\.from\(\s*["'`]shops["'`]\s*\)\s*(?:\.\w+\([^()]*\)\s*)*?\.insert\(/;

/**
 * Strips block and line comments so a passing mention of `onNewShopCreated` in
 * prose can't satisfy the invariant — only a real reference in code counts.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("new-shop side effects are wired into every install path", () => {
  const files = SEARCH_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)));

  it("finds the source files to scan", () => {
    // Guards against a broken walk silently making this suite vacuous.
    expect(files.length).toBeGreaterThan(50);
  });

  it("routes every `shops` row insert through onNewShopCreated", () => {
    const inserters = files.filter((f) =>
      SHOPS_INSERT.test(readFileSync(f, "utf8")),
    );

    // Both known install paths must still be found — if this drops to zero the
    // regex has rotted and the invariant is silently passing.
    expect(inserters.length).toBeGreaterThanOrEqual(2);

    const offenders = inserters.filter(
      (f) => !stripComments(readFileSync(f, "utf8")).includes("onNewShopCreated"),
    );

    expect(
      offenders.map((f) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, "/")),
    ).toEqual([]);
  });

  it("covers the two known install paths", () => {
    const rel = files
      .filter((f) => SHOPS_INSERT.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(REPO_ROOT.length + 1).replace(/\\/g, "/"));

    expect(rel).toContain("app/api/auth/shopify/callback/route.ts");
    expect(rel).toContain("app/api/auth/shopify/token-exchange/route.ts");
  });
});
