import type { DefenceNarrativeOutput, EvidenceFact } from "@/lib/defence/types";

type Status = "draft" | "stale" | "final" | "submitted" | "superseded" | "failed" | "skipped";

/** A `defence_packages` row as the workspace endpoint serves it. */
export interface DefencePackageRow {
  /** Signed new-tab preview link from the workspace API. */
  preview_url?: string | null;
  id: string;
  version: number;
  status: Status;
  package_mode: "full" | "narrow" | null;
  generated_at: string;
  generated_by: "system" | "merchant" | "admin";
  pdf_path: string | null;
  evidence_hash: string;
  llm_model: string | null;
  prompt_family: string | null;
  prompt_version: number | null;
  reason_code_module: string | null;
  validation_status: "ok" | "failed" | "skipped" | null;
  validation_errors: Array<{ section?: string; rule?: string; message?: string }>;
  failure_code: string | null;
  failure_reason: string | null;
  submitted_at: string | null;
  narrative_json: DefenceNarrativeOutput | null;
  facts_json: EvidenceFact[] | null;
}
