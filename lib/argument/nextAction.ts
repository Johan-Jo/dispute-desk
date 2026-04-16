/**
 * Next Action Engine.
 *
 * Computes the single most important next step for the merchant.
 */

import type { SubmissionReadiness, ChecklistItemV2 } from "@/lib/types/evidenceItem";
import type { ArgumentMap, NextAction, MissingItemWithContext } from "./types";

interface NextActionInput {
  packExists: boolean;
  packStatus: string | null;
  readiness: SubmissionReadiness;
  missingItems: MissingItemWithContext[];
  argumentMap: ArgumentMap | null;
  savedToShopifyAt: string | null;
}

export function computeNextAction(input: NextActionInput): NextAction {
  const {
    packExists,
    packStatus,
    readiness,
    missingItems,
    argumentMap,
    savedToShopifyAt,
  } = input;

  // No pack
  if (!packExists) {
    return {
      label: "Generate evidence pack",
      description: "Collect evidence from your Shopify data.",
      severity: "critical",
    };
  }

  // Building
  if (packStatus === "building" || packStatus === "queued") {
    return {
      label: "Evidence pack is building",
      description: "This page updates automatically.",
      severity: "info",
    };
  }

  // Failed
  if (packStatus === "failed") {
    return {
      label: "Retry evidence generation",
      description: "The previous build failed. Try again.",
      severity: "critical",
    };
  }

  // Submitted
  if (readiness === "submitted" || savedToShopifyAt) {
    return {
      label: "Case submitted",
      description: "Waiting for issuer resolution.",
      severity: "info",
    };
  }

  // Highest-impact missing evidence, lowest effort first
  const critical = missingItems
    .filter((i) => i.priority === "critical")
    .sort((a, b) => {
      const effortOrder = { low: 0, medium: 1, high: 2 };
      return effortOrder[a.effort] - effortOrder[b.effort];
    });

  if (critical.length > 0) {
    const top = critical[0];
    return {
      label: `Add ${top.label}`,
      description: top.impact,
      targetTab: 1,
      targetField: top.field,
      severity: "warning",
    };
  }

  // Ready
  if (readiness === "ready" || readiness === "ready_with_warnings") {
    return {
      label: "Review & submit",
      description: "Case is ready for submission.",
      targetTab: 2,
      severity: "info",
    };
  }

  // Blocked
  if (readiness === "blocked") {
    return {
      label: "Resolve blockers",
      description: "Required evidence is missing.",
      targetTab: 1,
      severity: "critical",
    };
  }

  return {
    label: "Review evidence",
    description: "Check your evidence and argument.",
    targetTab: 1,
    severity: "info",
  };
}
