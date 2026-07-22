import { describe, it, expect } from "vitest";
import { resolveSort } from "../disputeListHelpers";

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
