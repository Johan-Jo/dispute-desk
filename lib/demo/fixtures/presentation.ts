/**
 * Demo `presentation` — the shared 4-dimension presentation model, built for
 * fixture disputes by the REAL resolver.
 *
 * ── WHY THIS CALLS THE PRODUCTION RESOLVER ────────────────────────────
 *
 * Every surface that renders a status now reads `dispute.presentation` and
 * falls back to a legacy `normalized_status` badge when it is absent
 * (`DashboardRecentDisputesPreview.tsx:161`, `WorkspaceShell.tsx:168`). The
 * fallback does not throw and does not warn — it silently renders the
 * pre-PR#410 badge. So when the shim stopped matching the contract, the demo
 * did not break; it quietly reverted to the old design, which is how it
 * shipped that way to a live demo URL.
 *
 * Hand-writing a `DisputePresentation` literal here would reproduce that
 * failure the next time a dimension is added: the literal would still satisfy
 * the type, still render, and still be wrong. Calling `resolvePresentation`
 * means the demo is derived from the same facts and the same rules as prod —
 * a new dimension appears in the demo automatically, and a changed input type
 * is a COMPILE error rather than a silent visual regression.
 *
 * `resolvePresentation` is a pure function over plain facts (no server-only
 * imports, no DB, no i18n), so it is safe in the client bundle the shim runs
 * in.
 */

import {
  resolvePresentation,
  type DisputePresentation,
} from "@/lib/disputes/presentation";
import type { DemoDispute } from "./types";

/**
 * Map a fixture dispute onto the resolver's fact inputs.
 *
 * The fixture's `status` is a demo-local flag, not a normalized status — the
 * shim already maps it at the API boundary and we mirror that mapping here so
 * the chip and the row agree.
 */
export function buildDemoPresentation(d: DemoDispute): DisputePresentation {
  const isSubmitted = d.status === "submitted";
  const isCovered = d.status === "covered";
  const isBlocked = d.status === "blocked";

  const normalizedStatus =
    isCovered ? "needs_review" : isBlocked ? "action_needed" : d.status;

  // Covered and fatal-loss fixtures never had a pack built (see the
  // `strengthFor` comment in fetchShim.ts), so they carry no pack status —
  // which is what drives `building_evidence` / `monitoring` rather than
  // `pack_prepared`.
  const packStatus = isCovered || isBlocked ? null : "ready";

  return resolvePresentation({
    /* ── Lifecycle facts ── */
    finalOutcome: null,
    closedAt: null,
    submissionState: isSubmitted ? "submitted_confirmed" : "not_saved",
    normalizedStatus,
    packStatus,

    /* ── Strength ── */
    // `covered` / `fatal_loss` are demo-local strength flags with no
    // rules-engine equivalent; the engine's pre-assessment value is
    // `insufficient`, which the resolver maps to `not_assessed`.
    strengthOverall:
      d.strength === "strong" || d.strength === "moderate" || d.strength === "weak"
        ? d.strength
        : "insufficient",

    /* ── Attention facts ── */
    // The weak fixture (dp-2406) is the one that genuinely asks the merchant
    // for something; everything else is either prepared or already sent.
    attentionReason: d.strength === "weak" ? "missing_required_evidence" : null,
    needsAttention: d.status === "needs_review" || isBlocked,
    integrationReconnectRequired: false,
    gorgiasActionableCount: 0,
    gorgiasEvidenceStale: false,
    automationMode: d.strength === "weak" ? "review" : "auto",
    approvedForSaveAt: null,
    concreteContribution: null,
  });
}
