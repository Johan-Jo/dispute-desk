import { describe, it, expect } from "vitest";
import {
  archiveTier,
  autopilotInitialWorkflowStatus,
  isArchiveAutopilotEligible,
  shouldSkipAutopilotPublish,
} from "@/lib/resources/generation/tierAutopilotPolicy";

describe("archiveTier — derives Tier from archive signals", () => {
  it("pillar_page → A", () => {
    expect(archiveTier({ contentType: "pillar_page" })).toBe("A");
  });

  it("is_hub_article=true forces A regardless of content type", () => {
    expect(
      archiveTier({ contentType: "cluster_article", is_hub_article: true })
    ).toBe("A");
  });

  it("explicit tier_override=A wins over content_type", () => {
    expect(
      archiveTier({ contentType: "cluster_article", tier_override: "A" })
    ).toBe("A");
  });

  it("cluster_article default → B", () => {
    expect(archiveTier({ contentType: "cluster_article" })).toBe("B");
  });

  it("checklist default → C", () => {
    expect(archiveTier({ contentType: "checklist" })).toBe("C");
  });
});

describe("isArchiveAutopilotEligible — Tier A safeguard", () => {
  it("Tier A archive WITHOUT autopilot_approved is NOT eligible (default skip)", () => {
    expect(
      isArchiveAutopilotEligible({
        contentType: "pillar_page",
        autopilot_approved: false,
      })
    ).toBe(false);
  });

  it("Tier A archive WITH autopilot_approved=true is eligible", () => {
    expect(
      isArchiveAutopilotEligible({
        contentType: "pillar_page",
        autopilot_approved: true,
      })
    ).toBe(true);
  });

  it("Tier A inferred via is_hub_article=true is also gated", () => {
    expect(
      isArchiveAutopilotEligible({
        contentType: "cluster_article",
        is_hub_article: true,
        autopilot_approved: false,
      })
    ).toBe(false);
    expect(
      isArchiveAutopilotEligible({
        contentType: "cluster_article",
        is_hub_article: true,
        autopilot_approved: true,
      })
    ).toBe(true);
  });

  it("Tier A inferred via tier_override='A' is also gated", () => {
    expect(
      isArchiveAutopilotEligible({
        contentType: "cluster_article",
        tier_override: "A",
        autopilot_approved: false,
      })
    ).toBe(false);
  });

  it("Tier B archive is eligible without autopilot_approved", () => {
    expect(
      isArchiveAutopilotEligible({
        contentType: "cluster_article",
        autopilot_approved: false,
      })
    ).toBe(true);
  });

  it("Tier C archive is eligible without autopilot_approved", () => {
    expect(
      isArchiveAutopilotEligible({
        contentType: "checklist",
        autopilot_approved: false,
      })
    ).toBe(true);
  });

  it("null autopilot_approved is treated as not-approved for Tier A", () => {
    expect(
      isArchiveAutopilotEligible({
        contentType: "pillar_page",
        autopilot_approved: null,
      })
    ).toBe(false);
  });
});

describe("autopilotInitialWorkflowStatus", () => {
  it("Tier A → in-editorial-review (do not auto-publish)", () => {
    expect(autopilotInitialWorkflowStatus({ contentType: "pillar_page" })).toBe(
      "in-editorial-review"
    );
    expect(
      autopilotInitialWorkflowStatus({
        contentType: "cluster_article",
        is_hub_article: true,
      })
    ).toBe("in-editorial-review");
  });

  it("Tier B/C → scheduled (publish queue takes over)", () => {
    expect(autopilotInitialWorkflowStatus({ contentType: "cluster_article" })).toBe(
      "scheduled"
    );
    expect(autopilotInitialWorkflowStatus({ contentType: "checklist" })).toBe(
      "scheduled"
    );
  });
});

describe("shouldSkipAutopilotPublish", () => {
  it("Tier A skips publish-queue enqueue", () => {
    expect(shouldSkipAutopilotPublish({ contentType: "pillar_page" })).toBe(true);
  });

  it("Tier B/C run the standard publish-queue enqueue", () => {
    expect(shouldSkipAutopilotPublish({ contentType: "cluster_article" })).toBe(false);
    expect(shouldSkipAutopilotPublish({ contentType: "checklist" })).toBe(false);
  });
});
