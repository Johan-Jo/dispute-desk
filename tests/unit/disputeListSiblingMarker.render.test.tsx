/**
 * The multi-dispute marker is RENDERED, on both surfaces.
 *
 * WHY A RENDER TEST. `orderDisputeCounts` being correct proves nothing about
 * what the merchant reads — the whole defect here is a DISPLAY ambiguity, so a
 * helper assertion would restate the bug's own premise. Twice today a fix was
 * verified against a pure function while the page was unchanged; this closes
 * that door for the fix that is purely about pixels.
 *
 * The case: order #92389 carries two real disputes (two card transactions,
 * both disputed — verified against Shopify). They render as two rows differing
 * only in amount, which reads as duplicate ingest. The marker names the
 * relationship.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppProvider } from "@shopify/polaris";
import polarisEn from "@shopify/polaris/locales/en.json";
import messages from "@/messages/en.json";
import { DesktopDisputesTable } from "@/app/(embedded)/app/disputes/DesktopDisputesTable";
import { MobileDisputesList } from "@/app/(embedded)/app/disputes/MobileDisputesList";
import type { Dispute } from "@/app/(embedded)/app/disputes/disputeListHelpers";

/** Minimal `t` that resolves the one key under test and echoes the rest. */
function t(key: string, params?: Record<string, string | number>): string {
  const flat = key.replace(/^disputes\./, "");
  const value = (messages.disputes as Record<string, unknown>)[flat];
  if (typeof value !== "string") return key;
  return value.replace(/\{(\w+)\}/g, (_, p) => String(params?.[p] ?? `{${p}}`));
}

const ORDER = "gid://shopify/Order/8680215380302";

function dispute(id: string, amount: string, over: Partial<Dispute> = {}): Dispute {
  return {
    id,
    order_gid: ORDER,
    order_name: "#92389",
    customer_display_name: "Lisa Oestereich",
    reason: "PRODUCT_NOT_RECEIVED",
    amount,
    currency_code: "EUR",
    status: "needs_response",
    phase: "chargeback",
    initiated_at: "2026-08-11T16:39:39Z",
    due_at: "2026-09-06T03:00:00Z",
    closed_at: null,
    final_outcome: null,
    submission_state: "not_saved",
    normalized_status: "needs_review",
    ...over,
  } as unknown as Dispute;
}

/** #92389 exactly: two transactions, 55.95 + 50.36 = the 106.31 order total. */
const SPLIT = [dispute("18eeeb7e", "55.95"), dispute("a01dc3a9", "50.36")];
const SOLO = [
  dispute("solo", "42.00", {
    order_gid: "gid://shopify/Order/999",
    order_name: "#999",
  }),
];

function desktop(disputes: Dispute[]): string {
  return renderToStaticMarkup(
    <AppProvider i18n={polarisEn}>
      <DesktopDisputesTable
        disputes={disputes}
        searchParams={null}
        dateLocale="en-US"
        numberLocale="en-US"
        t={t}
      />
    </AppProvider>,
  );
}

function mobile(disputes: Dispute[]): string {
  return renderToStaticMarkup(
    <AppProvider i18n={polarisEn}>
      <MobileDisputesList
        disputes={disputes}
        activeTab="all"
        searchParams={null}
        dateLocale="en-US"
        numberLocale="en-US"
        t={t}
      />
    </AppProvider>,
  );
}

describe("#92389 — the two rows say they belong to one order", () => {
  it("desktop marks both positions", () => {
    const html = desktop(SPLIT);
    expect(html).toContain("1 of 2 on this order");
    expect(html).toContain("2 of 2 on this order");
  });

  it("mobile marks both positions — same guarantee on both surfaces", () => {
    const html = mobile(SPLIT);
    expect(html).toContain("1 of 2 on this order");
    expect(html).toContain("2 of 2 on this order");
  });

  it("both amounts still render — the marker adds, never replaces", () => {
    const html = desktop(SPLIT);
    expect(html).toContain("55.95");
    expect(html).toContain("50.36");
  });
});

describe("an ordinary single-dispute order is untouched", () => {
  it("desktop shows no marker", () => {
    expect(desktop(SOLO)).not.toContain("on this order");
  });

  it("mobile shows no marker", () => {
    expect(mobile(SOLO)).not.toContain("on this order");
  });
});
