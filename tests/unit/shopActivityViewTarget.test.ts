/**
 * What a view row says about the page that was visited.
 *
 * WHY. The first version rendered only a friendly name — "Viewed a dispute",
 * which does not say WHICH dispute — while the API had returned `path` from the
 * start. An API-shape assertion stays green through that, so the assertion has
 * to be on the rendering decision itself.
 *
 * The second version linked ONLY dispute detail, and linked it to
 * `/admin/disputes/<id>`. Both were wrong: every row should open, and it should
 * open the MERCHANT's page under impersonation, because the point of the
 * timeline is seeing what the merchant saw. Our admin dispute view is a
 * different page, and for Coverage / Help / Insights / Settings no admin
 * equivalent exists at all.
 */

import { describe, expect, it } from "vitest";
import { viewTarget } from "@/components/admin/ShopActivity";

const D = "bbca3c19-584f-4f4b-b3e2-520b99df64c9";

describe("viewTarget", () => {
  it("always carries the raw path — which page is the whole question", () => {
    expect(viewTarget("/app/disputes/[id]", `/app/disputes/${D}`).path).toBe(
      `/app/disputes/${D}`,
    );
    expect(viewTarget("/app/coverage", "/app/coverage").path).toBe(
      "/app/coverage",
    );
  });

  it("targets the merchant path for EVERY route, disputes included", () => {
    // Not /admin/disputes/<id>: the merchant page is what was viewed.
    for (const [route, path] of [
      ["/app/disputes/[id]", `/app/disputes/${D}`],
      ["/app/coverage", "/app/coverage"],
      ["/app/help", "/app/help"],
      ["/app", "/app"],
    ] as const) {
      expect(viewTarget(route, path).path).toBe(path);
      expect(viewTarget(route, path).path.startsWith("/app")).toBe(true);
    }
  });

  it("names the known routes", () => {
    expect(viewTarget("/app", "/app").label).toBe("Viewed Dashboard");
    expect(viewTarget("/app/disputes", "/app/disputes").label).toBe(
      "Viewed Disputes list",
    );
    expect(viewTarget("/app/disputes/[id]", `/app/disputes/${D}`).label).toBe(
      "Viewed Dispute",
    );
    expect(viewTarget("/app/coverage", "/app/coverage").label).toBe(
      "Viewed Coverage",
    );
  });

  it("degrades to a bare 'Viewed' for an unknown route, never a wrong name", () => {
    const t = viewTarget("/app/something-new", "/app/something-new");
    expect(t.label).toBe("Viewed");
    expect(t.path).toBe("/app/something-new");
  });
});
