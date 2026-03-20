import type { AutomationSetupPayload } from "./setupAutomation";

export function validateAutomationSetupPayload(
  payload: AutomationSetupPayload,
  installedTemplateIds: Set<string>
): string | null {
  for (const row of payload.reason_rows) {
    if (row.mode === "auto_build") {
      if (!row.pack_template_id) {
        return "auto_build_requires_template";
      }
      if (!installedTemplateIds.has(row.pack_template_id)) {
        return "template_must_be_installed";
      }
    }
    if (
      row.pack_template_id &&
      !installedTemplateIds.has(row.pack_template_id)
    ) {
      return "template_must_be_installed";
    }
  }
  return null;
}
