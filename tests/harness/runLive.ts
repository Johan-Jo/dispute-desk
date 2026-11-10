/**
 * The "live builders" (single-source plan 3.2): the pure builders
 * `recordInputsFromWorkspace` -> `buildDisputeRecord` and `deriveWorkspace`, plus
 * the render harness over both tabs. `wrap` lets a test hand them a tracked
 * payload instead of the plain one. The test file must install the module mocks
 * (see disputePage.renderedRealCases.test.tsx).
 */
import { createTranslator } from "use-intl/core";
import messages from "@/messages/en.json";
import { deriveWorkspace, type DeriveTranslators } from "@/app/(embedded)/app/disputes/[id]/hooks/deriveWorkspace";
import { recordInputsFromWorkspace, type WorkspaceWithPatterns } from "@/app/(embedded)/app/disputes/[id]/record/recordInputs";
import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
import { buildDisputeRecord } from "@/lib/disputes/disputeRecord";
import { createRecordFormat } from "@/lib/disputes/recordFormat";
import { renderDisputePage } from "./renderDisputePage";
import type { WorkspaceFixture } from "./fixtures";
import { workspaceDataOf } from "./fixtures";

const tr = (namespace?: string) =>
  createTranslator({ locale: "en", messages: messages as never, namespace: namespace as never }) as never;

export const translators = (): DeriveTranslators => ({
  tSource: tr("disputes.sourceCaption"),
  tWhy: tr("disputes.whyText"),
  tFieldAction: tr("disputes.fieldAction"),
  tWorkspace: tr("disputes.workspaceHook"),
  tRoot: tr(),
});

/** The pure builders only. */
export function runPureBuilders(data: WorkspaceData, nowIso: string): void {
  const inputs = recordInputsFromWorkspace(data as unknown as WorkspaceWithPatterns, nowIso);
  buildDisputeRecord(inputs, createRecordFormat("en"));
  deriveWorkspace(data, { completedFields: new Set(), justSubmitted: false }, translators());
}

/** Pure builders, then the render harness over Overview and Evidence. */
export function runLiveBuilders(
  f: WorkspaceFixture,
  wrap: (data: WorkspaceData) => WorkspaceData = (d) => d,
): void {
  const data = wrap(workspaceDataOf(f));
  runPureBuilders(data, f.meta.capturedAt);
  renderDisputePage(data, "overview");
  renderDisputePage(data, "evidence");
  // The deep link that opens the acknowledgement card (`?section=cardholder-ack`).
  renderDisputePage(data, "overview", { section: "cardholder-ack" });
}
