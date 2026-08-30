/**
 * Reason module: FRAUDULENT (Stage 5, plan §7).
 *
 * First module shipped because it is where the cases are: 45 of the 47
 * fully-analyzable prod disputes are FRAUDULENT losses. The plan originally
 * named PRODUCT_UNACCEPTABLE, which has exactly one.
 *
 * ── What this module can and cannot say ──
 *
 * Every case in the cohort is a LOSS. There is no won counterpart, so nothing
 * here may claim a configuration would have worked. What it does instead is
 * compare the submission-time record against the evidence a 10.4-style
 * unauthorised-transaction defence turns on, and report three things the record
 * PROVES:
 *
 *   1. a signal that supports the merchant was held and not shown to the issuer
 *   2. a signal that undercuts the merchant WAS shown to the issuer
 *   3. an element was absent entirely
 *
 * None of those asserts a cause. A withheld supporting signal is a lost
 * opportunity, not the reason the case lost.
 *
 * ── Signal polarity, and why it is the whole job ──
 *
 * "We held an AVS result" and "we held an AVS result that MATCHED" are
 * different facts, and only the second is evidence for the merchant. Withholding
 * a FAILED AVS from the issuer is correct — a bank-facing rebuttal never
 * volunteers a weakness. So a module that only counts presence would flag 27
 * correct suppressions as defects and miss the 14 real disclosures.
 *
 * ── Measured across the 50 FRAUDULENT/lost submitted packages ──
 *
 *   ip_location .................. 50 held, 0 shown; 45 of them `same_country`
 *   payment_authentication ....... 49 held, 22 shown
 *       shown avs=N (no match) .. 14   ← adverse signal disclosed
 *       shown avs=Y/Z (match) .... 7
 *       withheld, avs null ....... 27   ← Mastercard, no codes; correct
 *   prior_customer_history ....... 50 held, 12 shown
 *   delivery_proof ............... 35 held, 35 shown  (15 packages have none)
 *   customer_communication ....... 15 held,  2 shown
 *
 * The 14 avs=N disclosures were all built under prompt v9–v10 (2026-07-22 to
 * 2026-08-09). From prompt v13 / validator v1 (2026-08-12) the codes are null:
 * the `citable` gate in `factClassifier` closed it. So this module's most severe
 * finding is, on today's data, a confirmation that a shipped fix changed filed
 * output — which is exactly what a post-outcome analyser is for. The finding
 * still fires, and carries the version it was built under, so a reviewer can
 * see the boundary rather than chase a closed defect.
 */

import type { DraftFinding, LifecycleObservation } from "../findings";
import type {
  PostOutcomeSourceSnapshot,
  SnapshotEvidenceItem,
} from "../snapshotContract";

export const FRAUDULENT_MODULE_VERSION = 1;

export type SignalPolarity = "SUPPORTS_MERCHANT" | "UNDERCUTS_MERCHANT" | "NEUTRAL";

export interface FraudElement {
  category: string;
  /** Merchant-neutral label for the admin detail. */
  label: string;
  held: boolean;
  shownToIssuer: boolean;
  polarity: SignalPolarity;
  detail: string;
}

export interface FraudModuleResult {
  elements: FraudElement[];
  findings: DraftFinding[];
  observations: LifecycleObservation[];
}

/** AVS codes that evidence an address match. Z = postal only, A = street only. */
const AVS_SUPPORTING = new Set(["Y", "X", "D", "M", "F"]);
const AVS_PARTIAL = new Set(["Z", "A", "B", "P", "W"]);
const AVS_ADVERSE = new Set(["N", "C", "G", "I", "R", "S"]);

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Polarity of one fact, from its frozen value. Unknown shapes are NEUTRAL —
 * a module that guesses polarity from an unrecognised payload is inventing
 * evidence.
 */
export function fraudSignalPolarity(item: SnapshotEvidenceItem): {
  polarity: SignalPolarity;
  detail: string;
} {
  const v = item.signalValue ?? {};

  switch (item.category) {
    case "payment_authentication": {
      const avs = str(v.avsResult)?.toUpperCase() ?? null;
      const cvv = str(v.cvvResult)?.toUpperCase() ?? null;
      if (!avs && !cvv) {
        return { polarity: "NEUTRAL", detail: "No AVS or CVV result was recorded." };
      }
      if (avs && AVS_ADVERSE.has(avs)) {
        return {
          polarity: "UNDERCUTS_MERCHANT",
          detail: `Address verification did not match (AVS ${avs}).`,
        };
      }
      if (avs && AVS_SUPPORTING.has(avs)) {
        return { polarity: "SUPPORTS_MERCHANT", detail: `Address verification matched (AVS ${avs}).` };
      }
      if (avs && AVS_PARTIAL.has(avs)) {
        return {
          polarity: "SUPPORTS_MERCHANT",
          detail: `Address verification partially matched (AVS ${avs}).`,
        };
      }
      if (cvv === "M") {
        return { polarity: "SUPPORTS_MERCHANT", detail: "Security code matched." };
      }
      return { polarity: "NEUTRAL", detail: "Verification result is not conclusive either way." };
    }

    case "ip_location": {
      const match = str(v.locationMatch);
      if (match === "same_country") {
        return {
          polarity: "SUPPORTS_MERCHANT",
          detail: "The order was placed from the cardholder's own country.",
        };
      }
      if (match === "different_country") {
        return {
          polarity: "UNDERCUTS_MERCHANT",
          detail: "The order was placed from a different country to the cardholder.",
        };
      }
      return { polarity: "NEUTRAL", detail: "No usable location comparison was recorded." };
    }

    case "prior_customer_history": {
      const count = num(v.priorOrderCount);
      if (count !== null && count > 0) {
        return {
          polarity: "SUPPORTS_MERCHANT",
          detail: `${count} earlier order(s) from the same customer.`,
        };
      }
      if (count === 0) {
        return { polarity: "NEUTRAL", detail: "No earlier orders from this customer." };
      }
      return { polarity: "NEUTRAL", detail: "Customer history carries no order count." };
    }

    case "delivery_proof":
    case "shipping_tracking":
      return { polarity: "SUPPORTS_MERCHANT", detail: "Delivery or tracking evidence was held." };

    case "customer_communication":
      return { polarity: "SUPPORTS_MERCHANT", detail: "Customer contact was on record." };

    default:
      return { polarity: "NEUTRAL", detail: "Not scored by the fraud module." };
  }
}

/** Elements a 10.4-style unauthorised-transaction defence turns on. */
const TRACKED: Array<{ category: string; label: string; acquirable: boolean }> = [
  { category: "payment_authentication", label: "Payment verification (AVS/CVV)", acquirable: false },
  { category: "ip_location", label: "Order origin location", acquirable: false },
  { category: "prior_customer_history", label: "Prior customer history", acquirable: false },
  { category: "delivery_proof", label: "Delivery confirmation", acquirable: true },
  { category: "shipping_tracking", label: "Shipment tracking", acquirable: true },
  { category: "customer_communication", label: "Customer communication", acquirable: true },
];

export function runFraudulentModule(
  snapshot: PostOutcomeSourceSnapshot,
): FraudModuleResult {
  const findings: DraftFinding[] = [];
  const observations: LifecycleObservation[] = [];
  const elements: FraudElement[] = [];

  const held = [...snapshot.availableBeforeSubmission];
  const promptVersion = snapshot.submittedPackage?.promptVersion ?? "unknown";

  const withheldSupporting: Array<{ id: string; label: string; detail: string }> = [];
  const disclosedAdverse: Array<{ id: string; label: string; detail: string }> = [];
  const absent: string[] = [];

  for (const tracked of TRACKED) {
    const items = held.filter((e) => e.category === tracked.category);
    if (items.length === 0) {
      elements.push({
        category: tracked.category,
        label: tracked.label,
        held: false,
        shownToIssuer: false,
        polarity: "NEUTRAL",
        detail: "Not held at submission time.",
      });
      if (tracked.acquirable) absent.push(tracked.label);
      continue;
    }

    for (const item of items) {
      const { polarity, detail } = fraudSignalPolarity(item);
      elements.push({
        category: tracked.category,
        label: tracked.label,
        held: true,
        shownToIssuer: item.presentInSubmittedPackage,
        polarity,
        detail,
      });

      if (polarity === "SUPPORTS_MERCHANT" && !item.presentInSubmittedPackage) {
        withheldSupporting.push({ id: item.id, label: tracked.label, detail });
      }
      if (polarity === "UNDERCUTS_MERCHANT" && item.presentInSubmittedPackage) {
        disclosedAdverse.push({ id: item.id, label: tracked.label, detail });
      }
    }
  }

  /* ── An adverse signal reached the issuer ─────────────────────────────── */
  if (disclosedAdverse.length > 0) {
    findings.push({
      category: "INCORRECT_EVIDENCE_INTERPRETATION",
      confidence: "DEFINITE",
      severity: "HIGH",
      title: `${disclosedAdverse.length} signal(s) that undercut the merchant were shown to the issuer`,
      description:
        "The issuer-facing package disclosed a verification or origin result that works against the merchant's position on an unauthorised-transaction claim.",
      observedFact:
        disclosedAdverse.map((d) => `${d.label}: ${d.detail}`).join(" ") +
        ` Package built under prompt ${promptVersion}.`,
      counterfactualImprovement:
        "Keep a verification result that does not support the merchant out of issuer-facing content.",
      actionClass: "RULE_ENGINE",
      evidenceRefs: disclosedAdverse.map((d) => ({ id: d.id, note: d.detail })),
      ruleRefs: [{ id: "fraud.adverse_signal_disclosed", version: FRAUDULENT_MODULE_VERSION }],
    });
  }

  /* ── A supporting signal was held and never shown ─────────────────────── */
  if (withheldSupporting.length > 0) {
    findings.push({
      category: "INCORRECT_EVIDENCE_INTERPRETATION",
      confidence: "MODERATE",
      severity: "MEDIUM",
      title: `${withheldSupporting.length} signal(s) supporting the merchant were held but not shown to the issuer`,
      description:
        "These signals were on record before submission and favour the merchant on an unauthorised-transaction claim, but did not reach issuer-facing content. Whether each should have been cited is a review decision.",
      observedFact: withheldSupporting.map((w) => `${w.label}: ${w.detail}`).join(" "),
      counterfactualImprovement:
        "Review whether a supporting signal of this kind should be citable to the issuer for this reason code.",
      actionClass: "RULE_ENGINE",
      evidenceRefs: withheldSupporting.map((w) => ({ id: w.id, note: w.detail })),
      ruleRefs: [{ id: "fraud.supporting_signal_withheld", version: FRAUDULENT_MODULE_VERSION }],
    });
  }

  /* ── An acquirable element was absent entirely ────────────────────────── */
  if (absent.length > 0) {
    findings.push({
      category: "MISSING_ACQUIRABLE_EVIDENCE",
      confidence: "MODERATE",
      severity: "MEDIUM",
      title: `${absent.length} evidence element(s) a fraud defence relies on were not held`,
      description:
        "These elements were absent from the submission-time record. A future process could reasonably obtain them; that they were missing here does not mean they existed and were lost.",
      observedFact: `Not held at submission: ${absent.join(", ")}.`,
      counterfactualImprovement:
        "Capture these elements before the evidence deadline so they are available to cite.",
      actionClass: "EVIDENCE_ACQUISITION",
      evidenceRefs: [],
      ruleRefs: [{ id: "fraud.element_absent", version: FRAUDULENT_MODULE_VERSION }],
    });
  }

  observations.push({
    key: "fraud_evidence_profile",
    summary: "Fraud evidence elements held and shown",
    detail: elements
      .map(
        (e) =>
          `${e.label}: ${e.held ? (e.shownToIssuer ? "shown" : "held, not shown") : "not held"}` +
          (e.polarity === "NEUTRAL" ? "" : ` (${e.polarity === "SUPPORTS_MERCHANT" ? "supports" : "undercuts"})`),
      )
      .join("; "),
  });

  return { elements, findings, observations };
}
