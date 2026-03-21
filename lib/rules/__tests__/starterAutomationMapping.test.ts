import { describe, expect, it } from "vitest";
import { RULE_PRESETS } from "@/lib/rules/presets";
import { DISPUTE_REASONS_ORDER } from "@/lib/rules/disputeReasons";
import type { AutomationSetupPayload } from "@/lib/rules/setupAutomation";
import type { TemplateListItem } from "@/lib/types/templates";
import {
  applyStarterModeChange,
  coerceFraudPnrAutoWhenNoTemplates,
  pickTemplateIdForDisputeType,
  starterModesFromPayload,
} from "@/lib/rules/starterAutomationMapping";

function basePayload(overrides?: Partial<AutomationSetupPayload>): AutomationSetupPayload {
  const reason_rows = DISPUTE_REASONS_ORDER.map((reason) => ({
    reason,
    mode: "manual" as const,
    pack_template_id: null as string | null,
  }));
  return {
    reason_rows: overrides?.reason_rows ?? reason_rows,
    safeguards: overrides?.safeguards ?? {
      high_value_review_enabled: false,
      high_value_min: 500,
      catch_all_review_enabled: false,
    },
  };
}

describe("pickTemplateIdForDisputeType", () => {
  it("prefers recommended template for dispute type", () => {
    const catalog: TemplateListItem[] = [
      {
        id: "t-fraud",
        slug: "f",
        dispute_type: "FRAUD",
        is_recommended: true,
        min_plan: "free",
        created_at: "",
        updated_at: "",
        name: "Fraud",
        short_description: "",
        works_best_for: null,
        preview_note: null,
      },
      {
        id: "t-other",
        slug: "o",
        dispute_type: "GENERAL",
        is_recommended: false,
        min_plan: "free",
        created_at: "",
        updated_at: "",
        name: "G",
        short_description: "",
        works_best_for: null,
        preview_note: null,
      },
    ];
    expect(
      pickTemplateIdForDisputeType(["t-fraud", "t-other"], catalog, "FRAUD")
    ).toBe("t-fraud");
  });

  it("falls back to first installed id", () => {
    const catalog: TemplateListItem[] = [];
    expect(pickTemplateIdForDisputeType(["z1", "z2"], catalog, "FRAUD")).toBe(
      "z1"
    );
  });
});

describe("starterModesFromPayload", () => {
  it("maps fraud auto_build to auto_pack", () => {
    const p = basePayload({
      reason_rows: basePayload().reason_rows.map((row) =>
        row.reason === "FRAUDULENT"
          ? { ...row, mode: "auto_build", pack_template_id: "tpl" }
          : row
      ),
    });
    const m = starterModesFromPayload(p);
    expect(m["preset-fraud-auto"]).toBe("auto_pack");
  });

  it("maps high-value safeguard to review", () => {
    const p = basePayload({
      safeguards: {
        high_value_review_enabled: true,
        high_value_min: 750,
        catch_all_review_enabled: false,
      },
    });
    const m = starterModesFromPayload(p);
    expect(m["preset-high-value-review"]).toBe("review");
  });
});

describe("applyStarterModeChange", () => {
  it("preserves unrelated reason rows", () => {
    const prev = basePayload();
    const preset = RULE_PRESETS.find((x) => x.id === "preset-fraud-auto")!;
    const sub = applyStarterModeChange(prev, preset, "review", {
      installedTemplateIds: [],
      catalog: [],
    });
    expect(sub.reason_rows.length).toBe(prev.reason_rows.length);
    const dup = sub.reason_rows.find((r) => r.reason === "DUPLICATE");
    expect(dup?.mode).toBe("manual");
  });

  it("sets fraud to auto_build when templates exist", () => {
    const prev = basePayload();
    const preset = RULE_PRESETS.find((x) => x.id === "preset-fraud-auto")!;
    const catalog: TemplateListItem[] = [
      {
        id: "tf",
        slug: "f",
        dispute_type: "FRAUD",
        is_recommended: true,
        min_plan: "free",
        created_at: "",
        updated_at: "",
        name: "F",
        short_description: "",
        works_best_for: null,
        preview_note: null,
      },
    ];
    const next = applyStarterModeChange(prev, preset, "auto_pack", {
      installedTemplateIds: ["tf"],
      catalog,
    });
    const fraud = next.reason_rows.find((r) => r.reason === "FRAUDULENT");
    expect(fraud?.mode).toBe("auto_build");
    expect(fraud?.pack_template_id).toBe("tf");
  });
});

describe("coerceFraudPnrAutoWhenNoTemplates", () => {
  it("downgrades auto_build to review when no templates", () => {
    const prev = basePayload({
      reason_rows: basePayload().reason_rows.map((row) =>
        row.reason === "FRAUDULENT"
          ? { ...row, mode: "auto_build", pack_template_id: "x" }
          : row
      ),
    });
    const next = coerceFraudPnrAutoWhenNoTemplates(prev, []);
    const fraud = next.reason_rows.find((r) => r.reason === "FRAUDULENT");
    expect(fraud?.mode).toBe("review");
    expect(fraud?.pack_template_id).toBeNull();
  });
});
