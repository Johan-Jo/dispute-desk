import { describe, it, expect } from "vitest";
import type {
  StepStatus,
  SkippedReason,
  StepState,
  StepId,
  StepsMap,
  SetupStateResponse,
  IntegrationType,
  IntegrationStatus,
} from "@/lib/setup/types";

describe("setup types", () => {
  it("StepStatus values are valid", () => {
    const statuses: StepStatus[] = ["todo", "in_progress", "done", "skipped"];
    expect(statuses).toHaveLength(4);
  });

  it("SkippedReason values are valid", () => {
    const reasons: SkippedReason[] = ["do_later", "not_relevant", "need_help"];
    expect(reasons).toHaveLength(3);
  });

  it("StepId values match expected set", () => {
    const ids: StepId[] = [
      "connection",
      "store_profile",
      "coverage",
      "automation",
      "activate",
    ];
    expect(ids).toHaveLength(5);
  });

  it("StepsMap can hold partial step states", () => {
    const map: StepsMap = {
      connection: { status: "done", completed_at: "2026-01-01" },
      store_profile: { status: "skipped", skipped_reason: "do_later" },
    };
    expect(map.connection?.status).toBe("done");
    expect(map.store_profile?.skipped_reason).toBe("do_later");
    expect(map.coverage).toBeUndefined();
  });

  it("SetupStateResponse shape is valid", () => {
    const response: SetupStateResponse = {
      steps: {
        connection: { status: "done" },
        store_profile: { status: "done" },
        coverage: { status: "todo" },
        automation: { status: "todo" },
        activate: { status: "todo" },
      },
      progress: { doneCount: 2, total: 5 },
      nextStepId: "coverage",
      allDone: false,
    };
    expect(response.progress.doneCount).toBe(2);
    expect(response.allDone).toBe(false);
  });

  it("IntegrationType values are valid", () => {
    const types: IntegrationType[] = [
      "shopify_tracking",
      "gorgias",
      "email",
      "warehouse",
    ];
    expect(types).toHaveLength(4);
  });

  it("IntegrationStatus values are valid", () => {
    const statuses: IntegrationStatus[] = [
      "not_connected",
      "connected",
      "needs_attention",
    ];
    expect(statuses).toHaveLength(3);
  });
});
