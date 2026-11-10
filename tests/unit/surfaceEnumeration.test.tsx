/**
 * Surface enumeration, proven by execution (single-source plan 3.3).
 *
 * Every file under app/** and components/** that imports the workspace payload
 * type, the workspace hook or `lib/disputes/presentation` and exports a function
 * must be REACHED - an exported function of it ran (V8 precise function
 * coverage) while the render harness and pure builders processed the real-case
 * fixtures - or be a baselined exemption with a reason. A new page or a new
 * `.ts` helper that takes the payload and is not wired into the harness fails.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("../harness/workspaceHookMock")).navigationMock);
vi.mock("@/app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace", async (orig) => ({
  ...(await orig<object>()),
  useDisputeWorkspace: (await import("../harness/workspaceHookMock")).useDisputeWorkspaceMock,
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFixtures } from "../harness/fixtures";
import { runLiveBuilders } from "../harness/runLive";
import { enumerateSurfaces, reachedSurfaces, scriptUrlToRepoRelative, startFunctionCoverage } from "../harness/surfaces";

const ROOT = path.resolve(__dirname, "../..");

/** Surfaces the harness does not reach, each with the reason. Can only shrink. */
const EXEMPT: Record<string, string> = {
  // Plan 3.3 initial exemptions: the dispute LIST and neighbours, which take their own row type.
  "app/(embedded)/app/disputes/DesktopDisputesTable.tsx": "Dispute list (desktop): a list row, not the dispute page; the list/dashboard attention signal is a follow-up (plan 2, 6).",
  "app/(embedded)/app/disputes/MobileDisputeCard.tsx": "Dispute list (mobile): a list row, not the dispute page; see DesktopDisputesTable.",
  "app/(embedded)/app/disputes/disputeListHelpers.ts": "Dispute list helpers (list rows, CSV, deep links); resolveAttention is unchanged by this plan.",
  "app/(portal)/portal/disputes/page.tsx": "Portal dispute list: a list of presentations, not the embedded dispute page.",
  "app/(embedded)/app/DashboardRecentDisputesPreview.tsx": "Dashboard recent-disputes preview: list rows from the shared presentation model.",
  "app/(embedded)/app/packs/[packId]/page.tsx": "Pack preview page (a pack, not a dispute record).",
  // Found by the PR 1 enumeration beyond the plan's initial list.
  "components/packs/detail/EvidenceBuilderSection.tsx": "Part of the pack preview page (packs/[packId]); not rendered on the dispute page.",
  "app/(embedded)/app/disputes/[id]/hooks/useDisputeWorkspace.ts":
    "The real hook (fetch + React state) is replaced by tests/harness/workspaceHookMock in the harness; its derived computation is deriveWorkspace, which IS reached.",
  "app/api/disputes/[id]/workspace/route.ts": "The producer: it builds the payload the fixtures record. Its output is the harness input, so it is not a consumer.",
  "app/api/disputes/route.ts": "Dispute LIST API (presentation per row); the list is out of this plan.",
  "app/api/dashboard/stats/route.ts": "Dashboard counts from the presentation model; list/dashboard counts are unchanged by this plan (criterion 4b).",
  "app/api/cron/claim-divergence-monitor/route.ts": "Cron monitor of claim divergence; reads presentation to compare, renders nothing.",
  "app/api/packs/[packId]/upload/route.ts": "Write path (evidence upload); imports presentation constants, renders nothing.",
};

describe("surface enumeration (reached by the harness, or baselined)", () => {
  let surfaces: ReturnType<typeof enumerateSurfaces> = [];
  let reached = new Set<string>();
  beforeAll(() => {
    surfaces = enumerateSurfaces(ROOT);
    const cov = startFunctionCoverage(ROOT);
    vi.useFakeTimers();
    try {
      for (const f of loadFixtures()) {
        vi.setSystemTime(new Date(f.meta.capturedAt));
        runLiveBuilders(f);
      }
    } finally {
      vi.useRealTimers();
    }
    reached = reachedSurfaces(surfaces, cov.stop());
  });

  it("finds the dispute page surfaces", () => {
    const files = surfaces.map((s) => s.file);
    expect(files).toContain("app/(embedded)/app/disputes/[id]/WorkspaceShell.tsx");
    expect(files).toContain("app/(embedded)/app/disputes/[id]/record/recordInputs.ts");
  });

  it("the reached set is not vacuous", () => {
    expect(reached.size).toBeGreaterThan(0);
    expect(reached.has("app/(embedded)/app/disputes/[id]/record/RecordWorkspace.tsx")).toBe(true);
  });

  it("script urls normalise the same on Windows and POSIX", () => {
    const rel = "app/(embedded)/app/disputes/[id]/WorkspaceShell.tsx";
    expect(scriptUrlToRepoRelative("file:///home/runner/work/r/r/app/(embedded)/app/disputes/%5Bid%5D/WorkspaceShell.tsx", "/home/runner/work/r/r")).toBe(rel);
    expect(scriptUrlToRepoRelative("/home/runner/work/r/r/" + rel + "?v=123", "/home/runner/work/r/r")).toBe(rel);
    expect(scriptUrlToRepoRelative("file:///C:/Users/x/repo/" + rel, "C:\\Users\\X\\repo")).toBe(rel);
    expect(scriptUrlToRepoRelative("C:\\Users\\x\\repo\\app\\(embedded)\\app\\disputes\\[id]\\WorkspaceShell.tsx", "C:/Users/x/repo")).toBe(rel);
    expect(scriptUrlToRepoRelative("node:internal/x", "/home/runner/work/r/r")).toBeNull();
  });

  it("every surface is reached or exempt (a new page/helper must be wired into the harness)", () => {
    const offenders = surfaces.map((s) => s.file).filter((f) => !reached.has(f) && !(f in EXEMPT));
    expect(offenders).toEqual([]);
  });

  it("no exemption is stale (not a surface any more, or now reached) - delete it", () => {
    const files = new Set(surfaces.map((s) => s.file));
    const stale = Object.keys(EXEMPT).filter((f) => !files.has(f) || reached.has(f));
    expect(stale).toEqual([]);
  });

  it("every exemption has a real reason", () => {
    for (const [f, why] of Object.entries(EXEMPT)) expect(why.trim().length, f).toBeGreaterThanOrEqual(20);
  });
});

describe("planted mutations (the enumerator is real)", () => {
  function plant(files: Record<string, string>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "surf-"));
    for (const [rel, src] of Object.entries(files)) {
      fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), src);
    }
    return dir;
  }
  const PAGE = `import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";\nexport default function NewPage({ data }: { data: WorkspaceData }) { return null; }\n`;
  const HELPER = `import type { WorkspaceData } from "../x";\nexport function describeIt(data: WorkspaceData): string { return data.dispute.id; }\n`;

  it("a new page.tsx that takes the payload is enumerated, and a harness that never runs it does not reach it", () => {
    const dir = plant({ "app/(embedded)/app/newthing/page.tsx": PAGE });
    try {
      const s = enumerateSurfaces(dir);
      expect(s.map((x) => x.file)).toEqual(["app/(embedded)/app/newthing/page.tsx"]);
      expect(reachedSurfaces(s, new Map()).size).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a new .ts helper that takes WorkspaceData is enumerated and unreached", () => {
    const dir = plant({ "components/x/describe.ts": HELPER });
    try {
      const s = enumerateSurfaces(dir);
      expect(s.map((x) => x.file)).toEqual(["components/x/describe.ts"]);
      expect(reachedSurfaces(s, new Map()).size).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an imported-but-unused file does not pass: only a function that RAN counts", () => {
    const dir = plant({ "components/x/describe.ts": HELPER });
    try {
      const s = enumerateSurfaces(dir);
      // The module loaded (its top level ran) but `describeIt` never did.
      expect(reachedSurfaces(s, new Map([["components/x/describe.ts", new Set(["somethingElse"])]])).size).toBe(0);
      expect(reachedSurfaces(s, new Map([["components/x/describe.ts", new Set(["describeIt"])]])).size).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a type-only module is not a surface", () => {
    const dir = plant({ "components/x/types.ts": `import type { WorkspaceData } from "../x";\nexport type Y = WorkspaceData;\n` });
    try {
      expect(enumerateSurfaces(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
