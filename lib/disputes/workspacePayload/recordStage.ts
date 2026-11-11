/**
 * Where an open dispute stands, read from the workspace payload.
 *
 * MOVED VERBATIM from `app/(embedded)/app/disputes/[id]/record/recordInputs.ts`
 * (merchant-asks step): the asks registry is computed server-side in
 * `enrichWorkspacePayload` and its `review_decision` gate (`canDecide`) needs the
 * stage, so the stage predicate has to live where both the route and the page can
 * call it. No logic changed.
 *
 * PARTLY DONE (single-source plan PR 2, section 4): "saved" now comes from `presentation.lifecycle`; the raw
 * `pack.savedToShopifyAt` stamp is read only when the payload predates `presentation`. Still reads
 * `appliedRule.mode` instead of the owner (`presentation.automationMode`). PR 2 deletes
 * `stageOf` in favour of the owners; the rawReadScan baseline entries for it
 * moved with it (this directory is on the scan's owner allow-list).
 */

import type { WorkspaceData } from "@/app/(embedded)/app/disputes/[id]/workspace-components/types";
import type { RecordStage, RecordStatus } from "@/lib/disputes/disputeRecord";

function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

interface PackageRow {
  version?: number | null;
}

function pkgRow(v: unknown): PackageRow | null {
  return rec(v) as PackageRow | null;
}

/** open | won | lost | closed — the decided view wins, then the presentation outcome, then the dispute row. */
export function recordStatusOf(data: WorkspaceData): RecordStatus {
  const d = data.dispute;
  const dv = data.decidedView ?? null;
  const p = data.presentation ?? null;
  return dv
    ? dv.outcome
    : p?.outcome === "won" || d.finalOutcome === "won"
      ? "won"
      : p?.outcome === "lost" || d.finalOutcome === "lost"
        ? "lost"
        : p?.outcome === "closed" || p?.terminal
          ? "closed"
          : "open";
}

/** The package is filed under "Require my approval" (review mode). */
export function isReviewMode(data: WorkspaceData): boolean {
  const owner = data.presentation?.automationMode;
  return owner != null ? owner === "review" : data.appliedRule?.mode === "review";
}

export function stageOf(data: WorkspaceData, status: RecordStatus): RecordStage {
  if (status !== "open") return "decided";
  const p = data.presentation;
  const dp = data.defencePackage;
  const pack = data.pack;
  const latest = pkgRow(dp?.latest);
  if (pack?.coverage && (pack.coverage as { isCovered?: boolean }).isCovered) return "covered";
  if (p?.lifecycle === "under_review") return "under_review";
  // The owner decides. The raw stamp is only read when the payload predates `presentation`: a stamp alone is not proof Shopify accepted a save (#23750).
  if (p?.lifecycle === "saved_to_shopify" || (!p && pack?.savedToShopifyAt)) return "saved";
  if (!pack) return "no_pack";
  const fatal = data.workspaceAssessment?.caseStrength?.fatalLoss;
  if (fatal?.triggered) return "fatal";
  if (pack.status === "failed" || pack.failureCode) return "failed";
  const building =
    ["queued", "building", "pending"].includes(pack.status) || pack.rebuildPending || !!pack.activeBuildJob || !!dp?.building;
  if (building || !latest || typeof latest.version !== "number") return "building";
  if (data.held?.held) return "held";
  if (p && (p.attention === "blocking" || p.attention === "requested" || p.attention === "technical_error")) return "needs_attention";
  if (isReviewMode(data)) return "prepared_review";
  return "prepared";
}
