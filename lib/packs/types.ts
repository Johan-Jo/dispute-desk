/**
 * Shared types for evidence pack building.
 */

export interface EvidenceSection {
  type: "order" | "shipping" | "tracking" | "policy" | "comms" | "other";
  label: string;
  source: string;
  data: Record<string, unknown>;
  /** Fields this section contributes to the completeness checklist. */
  fieldsProvided: string[];
}

export interface BuildContext {
  packId: string;
  disputeId: string;
  shopId: string;
  disputeReason: string | null;
  orderGid: string | null;
  shopDomain: string;
  accessToken: string;
  correlationId?: string;
}
