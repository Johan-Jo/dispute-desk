import { describe, expect, it } from "vitest";
import { normalizeSetupStepParam } from "@/lib/setup/normalizeStepParam";

describe("normalizeSetupStepParam", () => {
  it("strips junk after & in path segment (common URL typo)", () => {
    expect(normalizeSetupStepParam("automation&dd_debug=1")).toBe("automation");
  });

  it("keeps simple ids", () => {
    expect(normalizeSetupStepParam("automation")).toBe("automation");
    expect(normalizeSetupStepParam("connection")).toBe("connection");
  });
});
