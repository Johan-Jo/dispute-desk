/**
 * INVARIANT: the read-mode impersonation gate exempts the page-view beacon,
 * and NOTHING else.
 *
 * WHY. Read-mode impersonation blocks every non-GET, which is correct for
 * merchant data. But the page-view beacon is a POST, so read-mode admin
 * sessions -- the common case, and precisely the activity the page-view log
 * exists to make visible -- recorded nothing, while write-mode sessions
 * recorded fine. Found by self-test against live dev on 2026-09-15, after the
 * same feature had already shipped three times with a different hole each time.
 *
 * The exemption is safe ONLY because /api/page-view derives shop and actor from
 * the verified impersonation cookie, never from the request body. If that ever
 * changes, this exemption becomes a way for a read-only admin to write rows
 * against an arbitrary shop -- so the guard is pinned here rather than left to
 * a comment.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

describe("read-mode impersonation gate", () => {
  it("exempts the page-view beacon", () => {
    const mw = readFileSync(join(ROOT, "middleware.ts"), "utf8");
    expect(
      mw.includes('const isPageViewBeacon = pathname === "/api/page-view"'),
      "the beacon must be exempt or read-mode admin browsing records nothing",
    ).toBe(true);
    expect(
      mw.includes(
        'imp.mode === "read" && req.method !== "GET" && !isPageViewBeacon',
      ),
      "the exemption must be applied to the read-mode gate condition",
    ).toBe(true);
  });

  it("exempts exactly one path — the gate still blocks other writes", () => {
    const mw = readFileSync(join(ROOT, "middleware.ts"), "utf8");
    const gate = mw.slice(
      mw.indexOf('imp.mode === "read"'),
      mw.indexOf("IMPERSONATION_READ_ONLY"),
    );
    // One exemption flag only. A second `||` here would widen the hole.
    const exemptions = gate.match(/!is[A-Z]\w+/g) ?? [];
    expect(
      exemptions,
      "read mode must stay closed to everything but the beacon",
    ).toEqual(["!isPageViewBeacon"]);
  });

  it("the beacon never takes shop identity from the request body", () => {
    const route = readFileSync(
      join(ROOT, "app", "api", "page-view", "route.ts"),
      "utf8",
    );
    // Body is parsed for `path` only; shop comes from cookie/headers.
    expect(route).not.toMatch(/body\.\s*shopId/);
    expect(route).toMatch(/imp\?\.shopId \?\? req\.headers\.get\("x-shop-id"\)/);
  });
});
