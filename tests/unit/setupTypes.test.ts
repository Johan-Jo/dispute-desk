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
      "permissions",
      "open_in_admin",
      "overview",
      "disputes",
      "packs",
      "rules",
      "policies",
      "team",
    ];
    expect(ids).toHaveLength(8);
  });

  it("StepsMap can hold partial step states", () => {
    const map: StepsMap = {
      overview: { status: "done", completed_at: "2026-01-01" },
      permissions: { status: "skipped", skipped_reason: "do_later" },
    };
    expect(map.overview?.status).toBe("done");
    expect(map.permissions?.skipped_reason).toBe("do_later");
    expect(map.disputes).toBeUndefined();
  });

  it("SetupStateResponse shape is valid", () => {
    const response: SetupStateResponse = {
      steps: {
        permissions: { status: "done" },
        open_in_admin: { status: "done" },
        overview: { status: "todo" },
        disputes: { status: "todo" },
        packs: { status: "todo" },
        rules: { status: "todo" },
        policies: { status: "todo" },
        team: { status: "todo" },
      },
      progress: { doneCount: 2, total: 8 },
      nextStepId: "overview",
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
