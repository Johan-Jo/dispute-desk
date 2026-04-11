export type DisputePhaseMatch = "inquiry" | "chargeback";

export interface RuleMatch {
  reason?: string[];
  status?: string[];
  amount_range?: { min?: number; max?: number };
  /** Restrict the rule to disputes in the listed phases. Empty/undefined matches both. */
  phase?: DisputePhaseMatch[];
}

export interface RuleAction {
  mode: "auto_pack" | "review" | "manual";
  pack_template_id?: string | null;
  require_fields?: string[];
}

export interface Rule {
  id: string;
  shop_id: string;
  enabled: boolean;
  match: RuleMatch;
  action: RuleAction;
  priority: number;
  name?: string;
  created_at: string;
  updated_at: string;
}

export interface RuleEvalResult {
  matchedRule: Rule | null;
  action: RuleAction;
  packTemplateId: string | null;
}
