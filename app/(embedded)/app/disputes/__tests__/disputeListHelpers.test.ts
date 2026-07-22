import { describe, it, expect } from "vitest";
import { parseListDeepLink, resolveSort } from "../disputeListHelpers";

describe("parseListDeepLink", () => {
  // Regression for blume-box 2026-07-22: the dashboard "Needs action" tile
  // deep-links to ?normalized_status=new,action_needed,needs_review, but the
  // page ignored the param — the first fetch ran UNFILTERED and rendered
  // resolved 2018 disputes (stale due_at) at the top of the due-date sort.
  it("parses the dashboard 'Needs action' deep-link into filtered open-tab state", () => {
    const sp = new URLSearchParams(
      "normalized_status=new,action_needed,needs_review",
    );
    expect(parseListDeepLink(sp)).toEqual({
      statuses: ["new", "action_needed", "needs_review"],
      tab: "active",
    });
  });

  it("a status deep-link implies the active tab (closed=false) so resolved rows are excluded", () => {
    const sp = new URLSearchParams("normalized_status=ready_to_submit");
    expect(parseListDeepLink(sp).tab).toBe("active");
  });

  it("closed=true wins the tab even alongside statuses", () => {
    const sp = new URLSearchParams("normalized_status=won&closed=true");
    expect(parseListDeepLink(sp).tab).toBe("closed");
  });

  it("no params → unfiltered 'all' tab (plain navigation unchanged)", () => {
    expect(parseListDeepLink(new URLSearchParams(""))).toEqual({
      statuses: [],
      tab: "all",
    });
    expect(parseListDeepLink(null)).toEqual({ statuses: [], tab: "all" });
  });

  it("trims and drops empty segments", () => {
    const sp = new URLSearchParams("normalized_status=new,%20action_needed,,");
    expect(parseListDeepLink(sp).statuses).toEqual(["new", "action_needed"]);
  });
});

describe("resolveSort", () => {
  // The core fix (2026-07-22): the default sort on open/active/all views is
  // due-date-ascending (soonest-due first), so a dispute due today lands on
  // page 1 instead of page 3–4. Previously `default` sent `initiated_at desc`
  // while the UI pill claimed "Most urgent" — a display/behavior mismatch.
  it("defaults open/active/all tabs to due_at ascending (soonest due first)", () => {
    expect(resolveSort("default", "all")).toEqual({ sort: "due_at", sort_dir: "asc" });
    expect(resolveSort("default", "active")).toEqual({ sort: "due_at", sort_dir: "asc" });
  });

  it("defaults the closed tab to closed_at descending (recently resolved first)", () => {
    expect(resolveSort("default", "closed")).toEqual({ sort: "closed_at", sort_dir: "desc" });
  });

  it("maps the explicit 'urgency' choice to due_at ascending", () => {
    expect(resolveSort("urgency", "all")).toEqual({ sort: "due_at", sort_dir: "asc" });
  });

  it("maps 'amount' to amount descending", () => {
    expect(resolveSort("amount", "active")).toEqual({ sort: "amount", sort_dir: "desc" });
  });

  it("keeps 'newest' on the real Shopify dispute date (initiated_at desc)", () => {
    // initiated_at, NOT created_at — a historical import gives every row a
    // near-identical created_at that scrambles ordering.
    expect(resolveSort("newest", "all")).toEqual({ sort: "initiated_at", sort_dir: "desc" });
  });

  it("maps 'closed_desc' to closed_at descending", () => {
    expect(resolveSort("closed_desc", "closed")).toEqual({ sort: "closed_at", sort_dir: "desc" });
  });
});
