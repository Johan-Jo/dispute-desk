/**
 * `deriveWorkspace` (extracted from the hook, single-source plan 3.0.1) must
 * produce EXACTLY what the inline `derived` computation produced. The old code
 * is frozen in deriveWorkspaceLegacy.ts; both run on every captured real-case
 * fixture, with and without optimistic
 * client state, and the results are compared structurally.
 */
import { describe, expect, it } from "vitest";
import { createTranslator } from "use-intl/core";
import messages from "@/messages/en.json";
import { deriveWorkspace, type DeriveTranslators } from "@/app/(embedded)/app/disputes/[id]/hooks/deriveWorkspace";
import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
import { legacyDerived } from "./deriveWorkspaceLegacy";
import { loadFixtures, workspaceDataOf } from "../harness/fixtures";

const tr = (namespace?: string) => createTranslator({ locale: "en", messages: messages as never, namespace: namespace as never }) as never;
const translators = (): DeriveTranslators => ({
  tSource: tr("disputes.sourceCaption"),
  tWhy: tr("disputes.whyText"),
  tFieldAction: tr("disputes.fieldAction"),
  tWorkspace: tr("disputes.workspaceHook"),
  tRoot: tr(),
});

const cases: Array<[string, WorkspaceData | null]> = [
  ["no data (loading)", null],
  ...loadFixtures().map((f): [string, WorkspaceData] => [`fixture ${f.meta.case}`, workspaceDataOf(f)]),
];

const states = (data: WorkspaceData | null) => {
  const missing = (data?.pack?.checklistV2 ?? []).filter((c) => c.status === "missing").map((c) => c.field);
  return [
    { completedFields: new Set<string>(), justSubmitted: false },
    { completedFields: new Set<string>(missing), justSubmitted: false },
    { completedFields: new Set<string>(), justSubmitted: true },
  ];
};

describe("deriveWorkspace === the frozen inline derived", () => {
  it("covers real-case fixtures", () => {
    expect(cases.filter(([n]) => n.startsWith("fixture ")).length).toBeGreaterThanOrEqual(7);
  });

  for (const [name, data] of cases) {
    it(name, () => {
      for (const st of states(data)) {
        const next = deriveWorkspace(data, st, translators());
        const prev = legacyDerived(data, st, translators());
        expect(next).toEqual(prev);
      }
    });
  }
});
