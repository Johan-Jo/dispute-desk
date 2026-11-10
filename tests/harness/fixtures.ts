/** Captured real-case workspace fixtures (scripts/fixtures/capture-workspace-fixture.mjs) and the shared enrichment. */
import fs from "node:fs";
import path from "node:path";
import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
import { enrichWorkspacePayload } from "@/lib/disputes/workspacePayload/enrich";
import type { EnrichSourceRows } from "@/lib/disputes/workspacePayload/sourceRows";

export interface WorkspaceFixture {
  meta: { case: string; disputeId: string; note: string | null; capturedAt: string; source: string };
  payload: Record<string, unknown>;
  sourceRows: EnrichSourceRows;
}

const FIXTURE_DIR = path.resolve(__dirname, "../fixtures/workspace");

export function loadFixtures(): WorkspaceFixture[] {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8")) as WorkspaceFixture);
}

export function fixtureByCase(name: string): WorkspaceFixture {
  const f = loadFixtures().find((x) => x.meta.case === name);
  if (!f) throw new Error(`no workspace fixture "${name}"`);
  return f;
}

/** The payload exactly as the route would send it: frozen pre-enrichment payload + the shared enrichment. */
export function workspaceDataOf(f: WorkspaceFixture): WorkspaceData {
  return enrichWorkspacePayload(f.payload, f.sourceRows) as unknown as WorkspaceData;
}

