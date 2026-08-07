/**
 * PR-C1 — the review-required banner is RENDERED, in both submission states.
 *
 * WHY A RENDER TEST AND NOT A HELPER ASSERTION. `deriveDefencePackageActionState`
 * has returned `showReviewRequired` since the first review pass, and the helper
 * test asserted it. The component, however, rendered the banner only inside the
 * `isSubmittedToBank` branch and never read `showReviewRequired` at all — so for
 * the main blocked population (packages never saved to Shopify) the approval
 * actions silently disappeared with no explanation, while the helper test stayed
 * green. Banner PLACEMENT cannot be proven by a pure function; it has to be
 * rendered.
 *
 * `renderToStaticMarkup` is deliberate: it is a real React render of the real
 * component through the real providers, with no effects — which is exactly the
 * first paint a merchant sees, and it needs no DOM dependency.
 */

import { describe, expect, it } from "vitest";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppProvider } from "@shopify/polaris";
import polarisEn from "@shopify/polaris/locales/en.json";
import messages from "@/messages/en.json";
import {
  CompleteDefencePackageCard,
  type DefencePackageRow,
} from "@/app/(embedded)/app/disputes/[id]/tabs/sections/CompleteDefencePackageCard";

const PKG = messages.disputes.reviewTab.package;
const REVIEW_REQUIRED_TITLE = PKG.reviewRequiredTitle;

const row = (over: Partial<DefencePackageRow> = {}): DefencePackageRow => ({
  id: "pkg-1",
  version: 2,
  status: "draft",
  package_mode: "full",
  generated_at: "2026-08-01T10:00:00.000Z",
  generated_by: "system",
  pdf_path: "shop/dispute/v2.pdf",
  evidence_hash: "h",
  llm_model: "m",
  prompt_family: "f",
  prompt_version: 10,
  reason_code_module: "visa_10_4_fraud",
  validation_status: "ok",
  validation_errors: [],
  failure_code: null,
  failure_reason: null,
  submitted_at: null,
  narrative_json: null,
  facts_json: null,
  ...over,
});

const BLOCKED = {
  blocked: true,
  reasons: ["affirmative_address_delivery_claim"],
  message: "This defence package was built with a delivery-address claim DisputeDesk can no longer support.",
};
const SAFE = { blocked: false, reasons: [], message: "" };

type CardProps = ComponentProps<typeof CompleteDefencePackageCard>;

function render(props: CardProps): string {
  return renderToStaticMarkup(
    <AppProvider i18n={polarisEn}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CompleteDefencePackageCard {...props} />
      </NextIntlClientProvider>
    </AppProvider>,
  );
}

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** Polaris escapes apostrophes in text nodes; compare on a stable prefix. */
const contains = (html: string, text: string) => html.includes(text.split("'")[0]);

describe("CompleteDefencePackageCard — blocked, never submitted", () => {
  const props = (safety: typeof BLOCKED | typeof SAFE): CardProps => ({
    packId: "pack-1",
    submittedToShopifyAt: null,
    defencePackage: {
      latest: row(),
      bankFacing: null,
      currentPromptVersion: 10,
      safety,
    },
  });

  it("renders the review-required banner exactly once", () => {
    const html = render(props(BLOCKED));
    expect(occurrences(html, REVIEW_REQUIRED_TITLE)).toBe(1);
    expect(html).toContain(BLOCKED.message);
  });

  it("does NOT render it for a safe candidate", () => {
    expect(occurrences(render(props(SAFE)), REVIEW_REQUIRED_TITLE)).toBe(0);
  });

  it("suppresses the approval action but keeps Preview and Regenerate", () => {
    const blockedHtml = render(props(BLOCKED));
    const safeHtml = render(props(SAFE));

    // The safe control proves the button is reachable in this exact state,
    // so its absence when blocked is the gate and not the fixture.
    expect(contains(safeHtml, "Approve v2")).toBe(true);
    expect(contains(blockedHtml, "Approve v2")).toBe(false);

    // Recovery stays available — regenerating is how a block is fixed.
    expect(contains(blockedHtml, PKG.viewPdf)).toBe(true);
    expect(contains(blockedHtml, PKG.moreActions)).toBe(true);
  });
});

describe("CompleteDefencePackageCard — blocked with an older bank-facing version", () => {
  const props = (safety: typeof BLOCKED | typeof SAFE): CardProps => ({
    packId: "pack-1",
    submittedToShopifyAt: "2026-08-02T09:00:00.000Z",
    defencePackage: {
      latest: row({ id: "pkg-2", version: 2, status: "final" }),
      bankFacing: row({ id: "pkg-1", version: 1, status: "submitted", submitted_at: "2026-08-02T09:00:00.000Z" }),
      currentPromptVersion: 10,
      safety,
    },
  });

  it("renders the review-required banner exactly once", () => {
    const html = render(props(BLOCKED));
    expect(occurrences(html, REVIEW_REQUIRED_TITLE)).toBe(1);
  });

  it("does NOT render it for a safe candidate", () => {
    expect(occurrences(render(props(SAFE)), REVIEW_REQUIRED_TITLE)).toBe(0);
  });

  it("suppresses the draft banner that hosts Resubmit", () => {
    const blockedHtml = render(props(BLOCKED));
    const safeHtml = render(props(SAFE));
    expect(safeHtml).toContain("Draft v2 is ready for review");
    expect(blockedHtml).not.toContain("Draft v2 is ready for review");
    expect(contains(blockedHtml, PKG.resubmitToShopify)).toBe(false);
  });
});
