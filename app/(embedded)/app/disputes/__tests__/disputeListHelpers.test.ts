import { describe, it, expect } from "vitest";
import {
  parseListDeepLink,
  resolveSort,
  figmaStatus,
  figmaReviewChip,
  csvEscape,
  disputesExportFilename,
  shopHandleFromLocation,
  type Dispute,
} from "../disputeListHelpers";

/** Minimal Dispute fixture — only fields the review helpers read. */
function dispute(over: Partial<Dispute>): Dispute {
  return {
    id: "d1",
    dispute_gid: "gid",
    order_gid: null,
    status: "needs_response",
    reason: "fraudulent",
    phase: "chargeback",
    amount: 100,
    currency_code: "USD",
    due_at: null,
    initiated_at: null,
    needs_review: false,
    last_synced_at: null,
    ...over,
  };
}

const idT = (k: string, p?: Record<string, string | number>) =>
  p ? `${k}:${JSON.stringify(p)}` : k;

describe("figmaReviewChip + figmaStatus (review lifecycle)", () => {
  it("returns null when there is no review decision", () => {
    expect(figmaReviewChip(dispute({}), idT)).toBeNull();
  });

  it("in_review → chip; with a future due date shows a day countdown", () => {
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const chip = figmaReviewChip(
      dispute({ review_state: "in_review", review_due_at: due }),
      idT,
    );
    expect(chip?.label).toBe("disputes.reviewChip.inReviewDue:{\"days\":3}");
  });

  it("in_review without a due date shows the plain label", () => {
    const chip = figmaReviewChip(dispute({ review_state: "in_review" }), idT);
    expect(chip?.label).toBe("disputes.reviewChip.inReview");
  });

  it("approved + conceded map to their chips", () => {
    expect(figmaReviewChip(dispute({ review_state: "approved" }), idT)?.label).toBe(
      "disputes.reviewChip.scheduled",
    );
    expect(figmaReviewChip(dispute({ review_state: "conceded" }), idT)?.label).toBe(
      "disputes.reviewChip.notDefended",
    );
  });

  it("conceded leaves the actionable views (figmaStatus → closed)", () => {
    expect(figmaStatus(dispute({ review_state: "conceded", needs_review: true }))).toBe(
      "closed",
    );
  });

  it("approved routes to under-review (scheduled, not actionable)", () => {
    expect(figmaStatus(dispute({ review_state: "approved", needs_review: true }))).toBe(
      "under-review",
    );
  });

  it("in_review stays actionable (needs-review)", () => {
    expect(figmaStatus(dispute({ review_state: "in_review", needs_review: true }))).toBe(
      "needs-review",
    );
  });

  // Regression — blume-box 0ab14b8f, 2026-07-31: the deadline cron saved the
  // evidence at 08:06 UTC but nothing clears `review_state`, so the row kept
  // wearing "Scheduled" beside its saved status while the submit tab and the
  // confirmation email both said it had been filed.
  it("drops the chip once the decision has been carried out (saved/sent/terminal)", () => {
    for (const lifecycle of ["saved_to_shopify", "under_review", "won"] as const) {
      expect(
        figmaReviewChip(
          dispute({
            review_state: "approved",
            presentation: { lifecycle } as Dispute["presentation"],
          }),
          idT,
        ),
      ).toBeNull();
    }
  });

  it("keeps the chip while the decision is still pending", () => {
    expect(
      figmaReviewChip(
        dispute({
          review_state: "approved",
          presentation: { lifecycle: "pack_prepared" } as Dispute["presentation"],
        }),
        idT,
      )?.label,
    ).toBe("disputes.reviewChip.scheduled");
  });
});

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
      attention: "",
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
      attention: "",
    });
    expect(parseListDeepLink(null)).toEqual({ statuses: [], tab: "all", attention: "" });
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


/* The disputes CSV export is reconciled against processor statements, so a
 * silently shifted column is worse than a visible failure. A merchant reported
 * the export truncating to one page on 2026-08-31; these pin the escaping half
 * of that fix. */
describe("csvEscape", () => {
  it("leaves an ordinary value untouched", () => {
    expect(csvEscape("Fred Vitus")).toBe("Fred Vitus");
    expect(csvEscape("")).toBe("");
  });

  it("quotes a value containing a comma", () => {
    expect(csvEscape("Vitus, Fred")).toBe('\"Vitus, Fred\"');
  });

  it("quotes AND doubles an embedded quote — the old version did neither", () => {
    // The previous inline escaper only quoted on comma, so this value passed
    // through raw and broke every column after it on the row.
    expect(csvEscape('Fred \"Bunny\" Vitus')).toBe(
      '\"Fred \"\"Bunny\"\" Vitus\"',
    );
  });

  it("quotes values containing CR or LF", () => {
    expect(csvEscape("line1\nline2")).toBe('\"line1\nline2\"');
    expect(csvEscape("line1\rline2")).toBe('\"line1\rline2\"');
  });

  it("round-trips a value that is both quoted and comma-bearing", () => {
    expect(csvEscape('a,\"b')).toBe('\"a,\"\"b\"');
  });
});


/* The bug a merchant actually hit: a formatted amount over 999 carries a
 * thousands separator, and the currency column was the one field the escaping
 * pass missed. 37 of 1,125 live disputes shifted every later column. */
describe("csvEscape on formatted currency", () => {
  it("quotes an amount with a thousands separator", () => {
    expect(csvEscape("$1,375.00")).toBe('\"$1,375.00\"');
  });

  it("quotes a non-USD amount with grouped digits", () => {
    // VND: the live row that split across three CSV fields.
    expect(csvEscape("₫3,139,148")).toBe('\"₫3,139,148\"');
  });

  it("leaves a sub-thousand amount alone", () => {
    expect(csvEscape("$210.00")).toBe("$210.00");
  });
});

describe("disputesExportFilename", () => {
  const when = new Date(2026, 7, 31); // 31 Aug 2026, local time

  it("names the content, the shop and the date", () => {
    expect(disputesExportFilename("blume-box", when)).toBe(
      "disputes-history-blume-box-2026-08-31.csv",
    );
  });

  it("omits the shop segment rather than inventing one", () => {
    expect(disputesExportFilename(null, when)).toBe(
      "disputes-history-2026-08-31.csv",
    );
  });

  it("zero-pads so files sort chronologically", () => {
    expect(disputesExportFilename("s", new Date(2026, 0, 5))).toBe(
      "disputes-history-s-2026-01-05.csv",
    );
  });

  it("sanitises a handle that would break a filename", () => {
    expect(disputesExportFilename("My Shop/../etc", when)).toBe(
      "disputes-history-my-shop-etc-2026-08-31.csv",
    );
  });
});

describe("shopHandleFromLocation", () => {
  it("reads the handle from the shop query param", () => {
    expect(
      shopHandleFromLocation("?shop=blume-box.myshopify.com&host=x", ""),
    ).toBe("blume-box");
  });

  it("falls back to the admin referrer path", () => {
    expect(
      shopHandleFromLocation("", "https://admin.shopify.com/store/cay-collective/apps/disputedesk-1"),
    ).toBe("cay-collective");
  });

  it("returns null when neither is available", () => {
    expect(shopHandleFromLocation("", "")).toBeNull();
  });
});
