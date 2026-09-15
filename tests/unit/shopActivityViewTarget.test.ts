/**
 * What a view row says about the page that was visited.
 *
 * WHY. The first version rendered only a friendly name — "Viewed a dispute",
 * which does not say WHICH dispute. The API had returned `path` and
 * `dispute_id` from the start; the component never rendered them. Asserting the
 * API shape would have stayed green through that, so the assertion has to be on
 * the rendering decision itself.
 */

import { describe, expect, it } from "vitest";
import { viewTarget } from "@/components/admin/ShopActivity";

const D = "bbca3c19-584f-4f4b-b3e2-520b99df64c9";

describe("viewTarget", () => {
  it("always carries the raw path — which page is the whole question", () => {
    expect(viewTarget("/app/disputes/[id]", `/app/disputes/${D}`, D).path).toBe(
      `/app/disputes/${D}`,
    );
    expect(viewTarget("/app/coverage", "/app/coverage", null).path).toBe(
      "/app/coverage",
    );
  });

  it("links a dispute view to the internal dispute page", () => {
    expect(viewTarget("/app/disputes/[id]", `/app/disputes/${D}`, D).href).toBe(
      `/admin/disputes/${D}`,
    );
  });

  it("gives a non-dispute path no href — a dead link is worse than none", () => {
    expect(viewTarget("/app/coverage", "/app/coverage", null).href).toBeNull();
    expect(viewTarget("/app", "/app", null).href).toBeNull();
  });

  it("names the known routes", () => {
    expect(viewTarget("/app", "/app", null).label).toBe("Viewed Dashboard");
    expect(viewTarget("/app/disputes", "/app/disputes", null).label).toBe(
      "Viewed Disputes list",
    );
    expect(viewTarget("/app/disputes/[id]", `/app/disputes/${D}`, D).label).toBe(
      "Viewed Dispute",
    );
  });

  it("degrades to a bare 'Viewed' for an unknown route, never a wrong name", () => {
    const t = viewTarget("/app/something-new", "/app/something-new", null);
    expect(t.label).toBe("Viewed");
    // The path still carries the answer even with no friendly name.
    expect(t.path).toBe("/app/something-new");
  });
});
