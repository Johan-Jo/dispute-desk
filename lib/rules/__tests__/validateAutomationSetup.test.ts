import { describe, it, expect } from "vitest";
import { validateAutomationSetupPayload } from "../validateAutomationSetup";
import type { AutomationSetupPayload } from "../setupAutomation";

describe("validateAutomationSetupPayload", () => {
  it("rejects auto_build without template", () => {
    const payload: AutomationSetupPayload = {
      reason_rows: [
        {
          reason: "FRAUDULENT",
          mode: "auto_build",
          pack_template_id: null,
        },
      ],
      safeguards: {
        high_value_review_enabled: false,
        high_value_min: 500,
        catch_all_review_enabled: false,
      },
    };
    expect(validateAutomationSetupPayload(payload, new Set(["t1"]))).toBe(
      "auto_build_requires_template"
    );
  });

  it("accepts auto_build with installed template", () => {
    const payload: AutomationSetupPayload = {
      reason_rows: [
        {
          reason: "FRAUDULENT",
          mode: "auto_build",
          pack_template_id: "t1",
        },
      ],
      safeguards: {
        high_value_review_enabled: false,
        high_value_min: 500,
        catch_all_review_enabled: false,
      },
    };
    expect(validateAutomationSetupPayload(payload, new Set(["t1"]))).toBeNull();
  });
});
