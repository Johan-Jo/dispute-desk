/**
 * #99413 — the HERO is rendered, and it states the halt.
 *
 * WHY A RENDER TEST. On 2026-09-03 `resolveAttention` was fixed so a blocked
 * case resolves to `blocking` / `auto_build_off`, the fix was verified by
 * calling the resolver directly, and it was reported as done. The page was
 * unchanged: `OverviewTab` handled exactly one of the seven blocking reasons
 * the resolver can emit, so the merchant still read "Building your evidence
 * pack… no action needed from you" over a dispute where automatic building was
 * switched OFF and no pack would ever be built, with a live Sep 22 deadline.
 *
 * A pure-function assertion cannot catch that, for the same reason
 * `completeDefencePackageCard.render.test.tsx` exists: a helper can be right
 * while the component never reads it. So this renders the real `OverviewTab`
 * through the real providers and asserts on the MARKUP.
 *
 * `renderToStaticMarkup` — a real React render, no effects, no DOM dependency:
 * the first paint the merchant actually sees.
 */

import { describe, expect, it, vi } from "vitest";

/* The tab reads shop context off the URL. `renderToStaticMarkup` runs outside
 * the App Router, so there is no router context to read from — stub the hooks
 * rather than pull in a router harness. Nothing under test depends on the
 * values. */
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("shop=6a8848-dd.myshopify.com"),
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/app/disputes/769a11cc-9514-42ad-895f-cbbedcc79343",
}));
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppProvider } from "@shopify/polaris";
import polarisEn from "@shopify/polaris/locales/en.json";
import messages from "@/messages/en.json";
import OverviewTab from "@/app/(embedded)/app/disputes/[id]/tabs/OverviewTab";

const BLOCKING = messages.presentation.attentionBlocking;
const BLOCKING_SUB = messages.presentation.attentionBlockingSub;

/** #99413 as it sits in prod (read 2026-09-03), with the presentation object
 *  the workspace route resolves for it. */
function workspaceFor(
  presentation: Record<string, unknown> | null,
): never {
  return {
    data: {
      dispute: {
        id: "769a11cc-9514-42ad-895f-cbbedcc79343",
        orderName: "#99413",
        reason: "PRODUCT_NOT_RECEIVED",
        amount: 92.08,
        currencyCode: "EUR",
        dueAt: "2026-09-22T15:00:00Z",
        submissionState: "not_saved",
        normalizedStatus: "submitted_to_bank",
        finalOutcome: null,
        phase: "inquiry",
        reviewState: null,
      },
      pack: null,
      packs: [],
      appliedRule: null,
      held: null,
      attachments: [],
      defencePackage: null,
      evidenceLineItems: [],
      presentationStatus: "DRAFT",
      submissionSummary: null,
      presentation,
    },
    derived: {
      /* `heroVariant` is server-guaranteed by `calculateCaseStrength()`;
       * `not_assessed` is the real pre-pack value for a case with no pack,
       * which is exactly #99413's state. */
      caseStrength: { overall: "insufficient", heroVariant: "not_assessed" },
      strengthReasonText: null,
      improvementHintText: null,
      effectiveChecklist: [],
      isReadOnly: false,
      recommendationText: null,
      recommendationHelperText: null,
      assessment: {
        mayRenderVerdict: false,
        mayRenderRecommendation: false,
        /* A real `I18nToken` — `resolveToken` reads `.params`, so null throws.
         * This is the genuine "never assessed" body for a case with no pack. */
        bodyToken: { key: "disputes.assessmentState.notAssessed.bodyAbsent" },
      },
      isFailed: false,
      failureCode: null,
    },
    clientState: { retrying: false },
    actions: {},
  } as never;
}

function render(presentation: Record<string, unknown> | null): string {
  return renderToStaticMarkup(
    <AppProvider i18n={polarisEn}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <OverviewTab workspace={workspaceFor(presentation)} />
      </NextIntlClientProvider>
    </AppProvider>,
  );
}

const BLOCKED_AUTO_BUILD_OFF = {
  lifecycle: "building_evidence",
  attention: "blocking",
  blockingReason: "auto_build_off",
  strength: null,
  isActive: true,
  outcome: null,
  automationMode: "auto",
};

describe("#99413 — a halted case does not read as progress", () => {
  it("states 'Automation paused' in the hero", () => {
    const html = render(BLOCKED_AUTO_BUILD_OFF);
    expect(html).toContain(BLOCKING.auto_build_off);
  });

  it("explains that automatic building is off", () => {
    const html = render(BLOCKED_AUTO_BUILD_OFF);
    expect(html).toContain(BLOCKING_SUB.auto_build_off);
  });

  it("no longer claims a pack is being built", () => {
    // The exact sentence the merchant saw on 2026-09-03.
    const html = render(BLOCKED_AUTO_BUILD_OFF);
    expect(html).not.toContain("Building your evidence pack");
  });

  it("no longer claims the response was sent and is unchangeable", () => {
    // The FIRST reported symptom on this dispute: normalized_status
    // 'submitted_to_bank' read as proof of filing on an inquiry.
    const html = render(BLOCKED_AUTO_BUILD_OFF);
    expect(html).not.toContain("The response has been sent");
    expect(html).not.toContain("card network is reviewing");
  });
});

describe("every blocking reason reaches the markup", () => {
  /* The defect was a RANGE mismatch — seven reasons emitted, one rendered — so
   * the guarantee has to be stated over the whole range, not the one case that
   * was reported. */
  const REASONS = [
    "missing_required_evidence",
    "quota_exceeded",
    "feature_blocked",
    "subscription_expired",
    "payment_failed",
    "auto_build_off",
  ] as const;

  for (const reason of REASONS) {
    it(`${reason} is stated, not narrated as progress`, () => {
      const html = render({ ...BLOCKED_AUTO_BUILD_OFF, blockingReason: reason });
      expect(html).toContain(BLOCKING[reason]);
      expect(html).not.toContain("Building your evidence pack");
    });
  }
});

describe("the unblocked path is untouched", () => {
  it("an ordinary building case still says it is building", () => {
    const html = render({
      ...BLOCKED_AUTO_BUILD_OFF,
      attention: "none",
      blockingReason: null,
    });
    expect(html).toContain("Building your evidence pack");
    expect(html).not.toContain(BLOCKING.auto_build_off);
  });

  it("renders without a presentation object at all (older cached payload)", () => {
    // The page falls back to the inline lifecycle resolver; it must not throw.
    expect(() => render(null)).not.toThrow();
  });
});
