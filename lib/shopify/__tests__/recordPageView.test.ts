/**
 * Path normalisation for `shop_page_views`.
 *
 * `route` is what aggregate queries group by, so a concrete id leaking into it
 * produces one bucket per dispute and makes "which pages do merchants use"
 * unanswerable. That is not hypothetical: the volume estimate in this feature's
 * own plan was wrong partly because demo-mode fixture paths
 * (`/app/disputes/dp-2403`) appeared as distinct routes and got counted as
 * separate merchant traffic.
 */

import { describe, expect, it } from "vitest";
import { normaliseRoute, extractDisputeId } from "../recordPageView";

const UUID = "bbca3c19-584f-4f4b-b3e2-520b99df64c9";

describe("normaliseRoute", () => {
  it("collapses a dispute uuid into the route pattern", () => {
    expect(normaliseRoute(`/app/disputes/${UUID}`)).toBe("/app/disputes/[id]");
  });

  it("collapses demo-mode fixture ids too", () => {
    // Real traffic on prod: these are fixtures, not disputes. Left concrete,
    // they scatter across the route breakdown as if they were real pages.
    expect(normaliseRoute("/app/disputes/dp-2403")).toBe("/app/disputes/[id]");
  });

  it("drops the query string", () => {
    expect(normaliseRoute(`/app/disputes/${UUID}?host=abc&id_token=xyz`)).toBe(
      "/app/disputes/[id]",
    );
  });

  it("leaves static routes untouched", () => {
    expect(normaliseRoute("/app/disputes")).toBe("/app/disputes");
    expect(normaliseRoute("/app/settings")).toBe("/app/settings");
    expect(normaliseRoute("/app")).toBe("/app");
  });

  it("is case-insensitive about uuids", () => {
    expect(normaliseRoute(`/app/disputes/${UUID.toUpperCase()}`)).toBe(
      "/app/disputes/[id]",
    );
  });
});

describe("extractDisputeId", () => {
  it("pulls the uuid out of a dispute path", () => {
    expect(extractDisputeId(`/app/disputes/${UUID}`)).toBe(UUID);
  });

  it("lowercases so the FK join matches", () => {
    expect(extractDisputeId(`/app/disputes/${UUID.toUpperCase()}`)).toBe(UUID);
  });

  it("returns null for a demo fixture — it is not a real dispute id", () => {
    // Must not become a dispute_id: there is no such row, and the column is
    // meant to join cleanly to `disputes`.
    expect(extractDisputeId("/app/disputes/dp-2403")).toBeNull();
  });

  it("returns null where there is no dispute", () => {
    expect(extractDisputeId("/app/disputes")).toBeNull();
    expect(extractDisputeId("/app")).toBeNull();
  });
});
