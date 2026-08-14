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

describe("CompleteDefencePackageCard — a FAILED rebuild over a filed version", () => {
  /* The production shape, 2026-08-14. blume-box dispute 11051073729: v4 was
   * filed and verified in Shopify at 13:00Z; the v5 rebuild had already failed
   * narrative validation twice and carries no PDF.
   *
   * The card called v5 "a newer draft awaiting your action" purely because its
   * id differed from the bank-facing row, and printed:
   *
   *   "Draft v5 is ready for review … If it looks correct, resubmit it to
   *    Shopify — that will replace v4."
   *
   * …immediately above its own "Validation failed" banner naming the reason v5
   * does not exist. `canSubmit` was already false, so the invitation had no
   * button in it: an instruction the merchant could not carry out, for a
   * package that was never built. */
  const failedLatest = row({
    id: "pkg-5",
    version: 5,
    status: "failed",
    validation_status: "failed",
    pdf_path: null,
    failure_code: "validation_failed",
    failure_reason: "1 validation error (after one retry)",
    validation_errors: [
      {
        section: "paymentAuthenticationArgument",
        rule: "unauthorized_claim",
        message:
          'paymentAuthenticationArgument makes an ambiguous address-delivery claim, but this case holds no "address_delivery" capability.',
      },
    ],
  });
  const filedV4 = row({
    id: "pkg-4",
    version: 4,
    status: "submitted",
    submitted_at: "2026-08-14T13:00:16.000Z",
  });

  const props = (latest: DefencePackageRow): CardProps => ({
    packId: "pack-1",
    submittedToShopifyAt: "2026-08-14T13:00:16.000Z",
    defencePackage: {
      latest,
      bankFacing: filedV4,
      currentPromptVersion: 10,
      // NOT a PR-C1 content block: nothing was built to judge. The existing
      // `packageBlocked` gate therefore never fired, which is why this reached
      // production after that gate shipped.
      safety: SAFE,
    },
  });

  it("does not call a failed build a draft that is ready for review", () => {
    const html = render(props(failedLatest));
    expect(html).not.toContain("Draft v5 is ready for review");
  });

  it("does not invite a resubmit that cannot happen", () => {
    const html = render(props(failedLatest));
    expect(contains(html, PKG.resubmitToShopify)).toBe(false);
    expect(html).not.toContain("that will replace v4");
  });

  it("still reports that the rebuild failed", () => {
    /* Suppressing the false invitation must not suppress the fact — the
     * merchant has to know the refresh did not happen. */
    const html = render(props(failedLatest));
    expect(contains(html, PKG.rebuildFailedTitle)).toBe(true);
  });

  it("says the filed version still stands, and does not shout", () => {
    /* v4 is at the bank and readback-verified; there is nothing to lose and
     * nothing to do, so this is a warning, not a critical failure. The card
     * used to render a red panel directly under a green "Saved to Shopify". */
    const html = render(props(failedLatest));
    expect(html).toContain("v4 is filed with Shopify and still stands");
    // Polaris expresses banner tone as a design token, not a status class.
    expect(html).toContain("--p-color-bg-fill-warning");
    expect(html).not.toContain("--p-color-bg-fill-critical");
  });

  it("is CRITICAL when nothing is filed — then the merchant really must act", () => {
    const html = render({
      packId: "pack-1",
      submittedToShopifyAt: null,
      defencePackage: {
        latest: failedLatest,
        bankFacing: null,
        currentPromptVersion: 10,
        safety: SAFE,
      },
    });
    expect(html).toContain("--p-color-bg-fill-critical");
    expect(contains(html, PKG.rebuildFailedBodyUnfiled)).toBe(true);
  });

  it("never speaks the validator's language to a merchant", () => {
    /* Section keys and capability names are how the module talks to itself.
     * A merchant cannot act on `paymentAuthenticationArgument`, and the detail
     * is already on the `defence_package_validation_failed` audit row. Same
     * class as the bare gateway codes forbidden everywhere else in the UI. */
    const html = render(props(failedLatest));
    for (const leak of [
      "paymentAuthenticationArgument",
      "address_delivery",
      "unauthorized_claim",
      "1 validation error (after one retry)",
    ]) {
      expect(html, `${leak} must not reach the merchant`).not.toContain(leak);
    }
  });

  it("keeps Regenerate reachable — it is the fix", () => {
    expect(contains(render(props(failedLatest)), PKG.moreActions)).toBe(true);
  });

  it("still offers the banner for a genuine newer draft — the gate is the status, not the fixture", () => {
    const realDraft = row({ id: "pkg-5", version: 5, status: "final" });
    const html = render(props(realDraft));
    expect(html).toContain("Draft v5 is ready for review");
  });
});
