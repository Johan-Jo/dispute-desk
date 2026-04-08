/**
 * Maps dispute + packs to a 5-step progress model for the embedded dispute detail stepper.
 * Merchant-facing labels — not a literal bank pipeline.
 */

export type ProgressPhase = "complete" | "current" | "pending";

export interface DisputeProgressStep {
  id: string;
  titleKey: string;
  descriptionKey: string;
  date: string | null;
  phase: ProgressPhase;
}

export interface DisputeProgressInput {
  initiated_at: string | null;
  status: string | null;
  packs: Array<{
    created_at: string;
    saved_to_shopify_at: string | null;
  }>;
}

function terminalStatus(status: string | null): boolean {
  return status === "won" || status === "lost" || status === "charge_refunded";
}

function firstSavedAt(
  packs: DisputeProgressInput["packs"],
): string | null {
  const dates = packs
    .map((p) => p.saved_to_shopify_at)
    .filter(Boolean) as string[];
  if (dates.length === 0) return null;
  dates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return dates[0] ?? null;
}

function firstPackAt(packs: DisputeProgressInput["packs"]): string | null {
  if (packs.length === 0) return null;
  const sorted = [...packs].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  return sorted[0]?.created_at ?? null;
}

/**
 * Returns the index of the "current" step (0..4). When terminal, returns 4 (outcome reached).
 */
/**
 * If the dispute status itself indicates review/submission has happened,
 * trust that over the pack's saved_to_shopify_at field — Shopify may
 * auto-submit evidence on the due date even without a DisputeDesk save.
 */
function statusImpliesReview(status: string | null): boolean {
  return status === "under_review" || status === "accepted";
}

function currentStepIndex(
  status: string | null,
  packs: DisputeProgressInput["packs"],
): number {
  if (terminalStatus(status)) return 4;

  const hasPack = packs.length > 0;
  const hasSaved = firstSavedAt(packs) != null;

  // Status-level signal overrides pack-level: if the bank is already
  // reviewing, evidence must have been submitted even if we missed the save event.
  if (statusImpliesReview(status)) return 3;

  if (!hasPack) return 1;
  if (!hasSaved) return 2;
  // Evidence is in Shopify — network / merchant review phase
  return 3;
}

export function getDisputeProgressSteps(
  d: DisputeProgressInput,
): DisputeProgressStep[] {
  const packs = d.packs ?? [];
  const terminal = terminalStatus(d.status);
  const initiated = d.initiated_at;
  const savedAt = firstSavedAt(packs);
  const packAt = firstPackAt(packs);
  const cur = currentStepIndex(d.status, packs);

  const phaseFor = (i: number): ProgressPhase => {
    if (terminal) return "complete";
    if (i < cur) return "complete";
    if (i === cur) return "current";
    return "pending";
  };

  const steps: DisputeProgressStep[] = [
    {
      id: "created",
      titleKey: "disputes.progress.createdTitle",
      descriptionKey: "disputes.progress.createdDesc",
      date: initiated,
      phase: phaseFor(0),
    },
    {
      id: "pack",
      titleKey: "disputes.progress.packTitle",
      descriptionKey: "disputes.progress.packDesc",
      date: packAt,
      phase: phaseFor(1),
    },
    {
      id: "saved",
      titleKey: "disputes.progress.savedTitle",
      descriptionKey: "disputes.progress.savedDesc",
      // If status implies review but we have no saved_to_shopify_at, use pack date as fallback
      date: savedAt ?? (statusImpliesReview(d.status) ? packAt : null),
      phase: phaseFor(2),
    },
    {
      id: "review",
      titleKey: "disputes.progress.reviewTitle",
      descriptionKey: "disputes.progress.reviewDesc",
      date: null,
      phase: phaseFor(3),
    },
    {
      id: "outcome",
      titleKey: "disputes.progress.outcomeTitle",
      descriptionKey: "disputes.progress.outcomeDesc",
      date: terminal ? savedAt ?? initiated : null,
      phase: phaseFor(4),
    },
  ];

  if (terminal) {
    for (const s of steps) s.phase = "complete";
  }

  return steps;
}
