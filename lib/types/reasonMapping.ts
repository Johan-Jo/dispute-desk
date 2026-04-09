import type { DisputePhase } from "@/lib/rules/disputeReasons";

export type { DisputePhase };

/** A reason-to-template mapping row with joined template info. */
export interface ReasonTemplateMapping {
  id: string;
  reason_code: string;
  dispute_phase: DisputePhase;
  template_id: string | null;
  label: string;
  family: string;
  is_active: boolean;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  /** Joined from pack_templates — null if no template mapped. */
  template_name: string | null;
  template_slug: string | null;
  template_status: string | null;
}

/** Summary stats for reason mapping overview. */
export interface ReasonMappingStats {
  total: number;
  mapped: number;
  unmapped: number;
  warnings: number;
}

/** Computed mapping status for UI display. */
export type MappingStatus = "mapped" | "unmapped" | "warning" | "deprecated-target";
