import { describe, it, expect } from "vitest";
import { getDisputeProgressSteps } from "@/lib/embedded/disputeDetailProgress";

describe("getDisputeProgressSteps", () => {
  it("marks all steps complete when status is terminal", () => {
    const steps = getDisputeProgressSteps({
      initiated_at: "2025-01-01T00:00:00Z",
      status: "won",
      packs: [
        {
          created_at: "2025-01-02T00:00:00Z",
          saved_to_shopify_at: "2025-01-03T00:00:00Z",
        },
      ],
    });
    expect(steps.every((s) => s.phase === "complete")).toBe(true);
  });

  it("sets current step to pack when no packs exist", () => {
    const steps = getDisputeProgressSteps({
      initiated_at: "2025-01-01T00:00:00Z",
      status: "needs_response",
      packs: [],
    });
    expect(steps[0]?.phase).toBe("complete");
    expect(steps[1]?.phase).toBe("current");
    expect(steps[2]?.phase).toBe("pending");
  });

  it("uses earliest saved_to_shopify_at for saved step date", () => {
    const steps = getDisputeProgressSteps({
      initiated_at: "2025-01-01T00:00:00Z",
      status: "under_review",
      packs: [
        {
          created_at: "2025-01-02T00:00:00Z",
          saved_to_shopify_at: "2025-01-10T00:00:00Z",
        },
        {
          created_at: "2025-01-03T00:00:00Z",
          saved_to_shopify_at: "2025-01-05T00:00:00Z",
        },
      ],
    });
    expect(steps[2]?.date).toBe("2025-01-05T00:00:00Z");
  });
});
