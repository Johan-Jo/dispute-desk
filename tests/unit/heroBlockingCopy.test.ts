/**
 * #99413: the page must state the halt, not narrate it as progress.
 *
 * THE INCIDENT (2026-09-03). An inquiry with `attention_reason='auto_build_off'`
 * — the merchant has automatic evidence building switched off, so NO pack will
 * ever be built — rendered "Building your evidence pack… usually within a few
 * hours" and "No action needed from you", over a live Sep 22 deadline.
 *
 * TWO defects, both needed for the page to lie:
 *   1. `resolveAttention` gated `attention_reason` behind the `needs_attention`
 *      boolean, which `updateNormalizedStatus` overwrites on every status sync
 *      without clearing the reason. 7 prod rows disagreed that way. So the
 *      resolver answered `none` and the blocker vanished before it reached any
 *      surface.
 *   2. The hero handled exactly ONE of the seven blocking reasons the resolver
 *      can emit (`approval_gate`). Even with (1) fixed, `auto_build_off` had
 *      no branch to render.
 *
 * Fixing only (1) is what made an earlier "verified" claim wrong: the resolver
 * was correct in isolation while the page was unchanged. These tests therefore
 * run BOTH layers, from the raw column values, and assert the copy key the page
 * actually picks.
 */

import { describe, it, expect } from "vitest";
import { resolvePresentation } from "@/lib/disputes/presentation";
import { heroBlockingCopy } from "@/lib/disputes/presentation/heroCopy";
import enMessages from "@/messages/en.json";

/** #99413 exactly as it sits in prod (read 2026-09-03). Note
 *  `needsAttention: false` alongside a live `auto_build_off` — the desync that
 *  hid the blocker. */
const LIVE_99413 = {
  finalOutcome: null,
  closedAt: null,
  submissionState: "not_saved",
  normalizedStatus: "submitted_to_bank",
  packStatus: null,
  strengthOverall: null,
  attentionReason: "auto_build_off",
  needsAttention: false,
  integrationReconnectRequired: false,
  gorgiasActionableCount: 0,
  automationMode: "auto" as const,
  approvedForSaveAt: null,
  concreteContribution: null,
  gorgiasEvidenceStale: false,
};

/* The hero resolves these through `tp = useTranslations("presentation")`, so
 * the keys `heroBlockingCopy` returns are relative to the `presentation`
 * namespace — NOT `disputes.overview`. Looking them up here the same way the
 * component does is the point: an earlier draft of this test read the wrong
 * namespace and went red, which is exactly the mismatch it should catch. */
const presentation = (
  enMessages as unknown as {
    presentation: Record<string, Record<string, string>>;
  }
).presentation;

describe("#99413 — end to end, from the raw columns to the copy key", () => {
  it("surfaces the blocker even though needs_attention is false", () => {
    const p = resolvePresentation(LIVE_99413);
    expect(p.attention).toBe("blocking");
    expect(p.blockingReason).toBe("auto_build_off");
  });

  it("does not claim the response was sent", () => {
    // The other half of the same page: normalized_status='submitted_to_bank'
    // is Shopify's ordinary open state for an inquiry, not proof we filed.
    const p = resolvePresentation(LIVE_99413);
    expect(p.lifecycle).not.toBe("under_review");
  });

  it("the HERO states the halt instead of 'Building your evidence pack'", () => {
    const p = resolvePresentation(LIVE_99413);
    const copy = heroBlockingCopy({
      lifecycle: p.lifecycle,
      attention: p.attention,
      blockingReason: p.blockingReason,
    });
    expect(copy).not.toBeNull();
    expect(copy!.titleKey).toBe("attentionBlocking.auto_build_off");
    expect(copy!.subtitleKey).toBe("attentionBlockingSub.auto_build_off");
  });

  it("and the resolved English says automation is off, not that we are building", () => {
    const p = resolvePresentation(LIVE_99413);
    const copy = heroBlockingCopy({
      lifecycle: p.lifecycle,
      attention: p.attention,
      blockingReason: p.blockingReason,
    });
    const title = presentation.attentionBlocking[p.blockingReason!];
    const sub = presentation.attentionBlockingSub[p.blockingReason!];
    expect(copy).not.toBeNull();
    expect(title).toBe("Automation paused");
    expect(sub).toMatch(/turned off in your settings/i);
    // The exact sentence the merchant saw, which must no longer win.
    expect(title).not.toMatch(/building/i);
    expect(sub).not.toMatch(/no action needed/i);
  });
});

describe("every blocking reason the resolver can emit has hero copy", () => {
  /* The original defect was a RANGE mismatch: the resolver emits seven
   * reasons, the hero handled one. Enumerating from the copy block means a
   * newly added reason without copy fails here rather than silently rendering
   * a lifecycle headline over a halted case. */
  const REASONS = [
    "missing_required_evidence",
    "quota_exceeded",
    "feature_blocked",
    "subscription_expired",
    "payment_failed",
    "auto_build_off",
  ] as const;

  for (const reason of REASONS) {
    it(`${reason} → stated in the hero, with copy that resolves`, () => {
      const copy = heroBlockingCopy({
        lifecycle: "building_evidence",
        attention: "blocking",
        blockingReason: reason,
      });
      expect(copy, `${reason} must not fall through to the lifecycle headline`).not.toBeNull();
      expect(presentation.attentionBlocking[reason]).toBeTruthy();
      expect(presentation.attentionBlockingSub[reason]).toBeTruthy();
    });
  }

  it("approval_gate keeps its dedicated block instead", () => {
    // Not an omission: that block offers the actual approve/hold controls,
    // which beats a headline that only names the state.
    expect(
      heroBlockingCopy({
        lifecycle: "pack_prepared",
        attention: "blocking",
        blockingReason: "approval_gate",
      }),
    ).toBeNull();
  });

  it("a decided case is never described as blocked", () => {
    for (const lifecycle of ["won", "lost", "closed"]) {
      expect(
        heroBlockingCopy({
          lifecycle,
          attention: "blocking",
          blockingReason: "auto_build_off",
        }),
      ).toBeNull();
    }
  });

  it("an unblocked case falls through to the lifecycle headline", () => {
    expect(
      heroBlockingCopy({
        lifecycle: "building_evidence",
        attention: "none",
        blockingReason: null,
      }),
    ).toBeNull();
  });
});
