export type StepStatus = "todo" | "in_progress" | "done" | "skipped";

export type SkippedReason = "do_later" | "not_relevant" | "need_help";

export interface StepState {
  status: StepStatus;
  payload?: Record<string, unknown>;
  completed_at?: string;
  skipped_reason?: SkippedReason | null;
}

export type StepId =
  | "connection"
  | "store_profile"
  | "coverage"
  | "automation"
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
