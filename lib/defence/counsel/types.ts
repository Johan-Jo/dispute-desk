/**
 * Defence counsel v2: the letter written as the merchant's counsel.
 * Plan series: docs/plans/defence-counsel/ (plans 2–4).
 *
 * Pipeline: records → claim ledger (code) → strategist (model) → writer
 * (model, N candidates) → checks (code) → judge (model) → composed PDF.
 */

import type { AddressExhibit, EvidenceFact, LaterOrderExhibit } from "../types";

export type ClaimWeight = "core" | "strong" | "supporting";

/** A statement this case may make, proven by a record. Built by code only. */
export interface LedgerClaim {
  /** Stable key, e.g. "carrier_delivered". */
  id: string;
  /** The canonical true sentence. */
  statement: string;
  /** Concrete values the writer may use ("4", "6 July 2026", "the same card"). */
  specifics: Record<string, string>;
  weight: ClaimWeight;
  /** Record ids the claim is derived from (fact ids, pack paths, API reads). */
  sources: string[];
  /** Private limits. Never printed; the writer must stay inside them. */
  mustNot: string[];
  /** A row this claim adds to the Chronology exhibit (e.g. the customer's
   *  later order), so the evidence is shown, not only described. */
  timelineEvent?: { at: string; text: string };
  /** The addresses this claim rests on, printed as an exhibit. */
  addressExhibit?: AddressExhibit;
  /** The later order this claim rests on, printed as an exhibit. */
  laterOrderExhibit?: LaterOrderExhibit;
}

/** One of the cardholder's orders on the merchant's store (Admin API read). */
export interface CustomerOrderSummary {
  name: string;
  createdAt: string;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  cancelled: boolean;
  deliveredAt: string | null;
  carrier: string | null;
  cardLast4: string | null;
  wallet: string | null;
  /** "CAD 109.67" — the order's total in the customer's currency. */
  total?: string | null;
}

export interface LedgerInput {
  moduleKey: string;
  /** Approved facts after classification (delivery_proof etc.). */
  facts: readonly EvidenceFact[];
  /** pack_json.sections (order, shipping, access_log, policies…). */
  packSections: ReadonlyArray<{ type?: string | null; source?: string | null; data?: unknown }>;
  orderName: string | null;
  disputeOpenedAt: string | null;
  disputeAmount: number | null;
  disputeCurrency: string | null;
  /** The cardholder's orders, including the disputed one. */
  customerOrders: readonly CustomerOrderSummary[];
}

/** The evidence sections a letter can carry between summary and conclusion. */
export type EvidenceSectionKey = "shipping" | "lineItems" | "chronology";

export interface PlaybookSection {
  key: EvidenceSectionKey;
  /** What the exhibit next to this section proves FOR THIS CLAIM. */
  mustProve: string;
  /** Claim ids; the section is omitted when none of them is in the ledger. */
  includeWhen: string[];
  /** The exhibit the reader sees next to the prose. */
  exhibit: string;
}

export interface Playbook {
  familyKey: string;
  analystQuestion: string;
  theories: Array<{ name: string; requiresClaims: string[]; shape: string }>;
  /** Default order of force. */
  sections: PlaybookSection[];
  leaveOut: string[];
  never: string[];
}

export interface StrategyPlan {
  theoryOfTheCase: string;
  theoryChosen: string;
  punchlineCandidates: string[];
  reasonsInOrderOfForce: Array<{ claimIds: string[]; point: string }>;
  sectionPlan: Array<{ key: EvidenceSectionKey; claimIds: string[]; job: string }>;
  omittedSections: Array<{ key: EvidenceSectionKey; why: string }>;
  specificsPlacement: Record<string, string>;
}

export interface CounselSection {
  paragraphs: string[];
  claimIds: string[];
}

export interface CounselDraft {
  /** Not used: one executive summary, no pull-quote (maintainer). */
  headline?: string;
  summary: CounselSection;
  evidenceSections: Array<CounselSection & { key: EvidenceSectionKey }>;
  conclusion: CounselSection;
}

export interface JudgeVerdict {
  decisionAfterSummaryOnly: "merchant" | "cardholder" | "undecided";
  decisionAfterFullLetter: "merchant" | "cardholder" | "undecided";
  theoryOfTheCase: string;
  strongestLine: string;
  weakestLine: string;
  scores: { punchline: number; clarity: number; evidenceUse: number; noRepetition: number; credibility: number };
  unclearSentences?: string[];
  redFlags: string[];
}
