export type StepStatus = "todo" | "in_progress" | "done" | "skipped";

export type SkippedReason = "do_later" | "not_relevant" | "need_help";

export interface StepState {
  status: StepStatus;
  payload?: Record<string, unknown>;
  completed_at?: string;
  skipped_reason?: SkippedReason | null;
}

/**
 * `handling` replaces the former `coverage` + `automation` pair (2026-07-27).
 * The naming was inverted: the step called "Automation" held only a
 * high-value toggle, while the real auto/review choice sat in a dropdown on
 * the "Coverage" step. Both now collapse into one step that asks the single
 * question that matters. See LEGACY_STEP_ID_MAP for the migration.
 */
export type StepId =
  | "connection"
  | "store_profile"
  | "handling"
  | "policies"
  | "activate";

export type StepsMap = Partial<Record<StepId, StepState>>;

export interface ShopSetupRow {
  shop_id: string;
  current_step: string | null;
  steps: StepsMap;
  updated_at: string;
}

export interface SetupStateResponse {
  steps: Record<StepId, StepState>;
  progress: { doneCount: number; total: number };
  nextStepId: StepId | null;
  allDone: boolean;
  shopId?: string;
}

export type IntegrationType =
  | "shopify_tracking"
  | "gorgias"
  | "email"
  | "warehouse";

export type IntegrationStatus =
  | "not_connected"
  | "connected"
  | "needs_attention";

export interface IntegrationRow {
  id: string;
  shop_id: string;
  type: IntegrationType;
  status: IntegrationStatus;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EvidenceFileRow {
  id: string;
  shop_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  kind: string;
  created_at: string;
}
