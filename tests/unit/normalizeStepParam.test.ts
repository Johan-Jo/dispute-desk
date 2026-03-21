import { describe, expect, it } from "vitest";
import { normalizeSetupStepParam } from "@/lib/setup/normalizeStepParam";

describe("normalizeSetupStepParam", () => {
  it("strips junk after & in path segment (common URL typo)", () => {
    expect(normalizeSetupStepParam("rules&dd_debug=1")).toBe("rules");
  });

  it("keeps simple ids", () => {
    expect(normalizeSetupStepParam("rules")).toBe("rules");
    expect(normalizeSetupStepParam("overview")).toBe("overview");
  });
});
