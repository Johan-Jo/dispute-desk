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
      "welcome_goals",
      "permissions",
      "sync_disputes",
      "business_policies",
      "evidence_sources",
      "automation_rules",
      "team_notifications",
    ];
    expect(ids).toHaveLength(7);
  });

  it("StepsMap can hold partial step states", () => {
    const map: StepsMap = {
      welcome_goals: { status: "done", completed_at: "2026-01-01" },
      permissions: { status: "skipped", skipped_reason: "do_later" },
    };
    expect(map.welcome_goals?.status).toBe("done");
    expect(map.permissions?.skipped_reason).toBe("do_later");
    expect(map.sync_disputes).toBeUndefined();
  });

  it("SetupStateResponse shape is valid", () => {
    const response: SetupStateResponse = {
      steps: {
        welcome_goals: { status: "done" },
        permissions: { status: "done" },
        sync_disputes: { status: "todo" },
        business_policies: { status: "todo" },
        evidence_sources: { status: "todo" },
        automation_rules: { status: "todo" },
        team_notifications: { status: "todo" },
      },
      progress: { doneCount: 2, total: 7 },
      nextStepId: "sync_disputes",
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
