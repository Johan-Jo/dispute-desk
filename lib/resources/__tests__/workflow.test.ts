import { describe, it, expect } from "vitest";
import {
  assertTransition,
  canTransition,
  getAllowedTransitions,
  isWorkflowStatus,
} from "@/lib/resources/workflow";

describe("workflow state machine", () => {
  it("canTransition allows drafting to in-editorial-review", () => {
    expect(canTransition("drafting", "in-editorial-review")).toBe(true);
  });

  it("canTransition rejects invalid jumps", () => {
    expect(canTransition("idea", "published")).toBe(false);
  });

  it("assertTransition throws on invalid transition", () => {
    expect(() => assertTransition("idea", "published")).toThrow(/Invalid workflow transition/);
  });

  it("assertTransition does not throw for valid transition", () => {
    expect(() => assertTransition("approved", "published")).not.toThrow();
  });

  it("getAllowedTransitions returns options for drafting", () => {
    const next = getAllowedTransitions("drafting");
    expect(next).toContain("in-editorial-review");
    expect(next).toContain("in-translation");
  });

  it("isWorkflowStatus narrows string", () => {
    expect(isWorkflowStatus("drafting")).toBe(true);
    expect(isWorkflowStatus("not-a-status")).toBe(false);
    expect(isWorkflowStatus(1)).toBe(false);
  });
});
