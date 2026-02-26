export interface Pack {
  id: string;
  shop_id: string;
  name: string;
  code: string | null;
  dispute_type: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  source: "MANUAL" | "TEMPLATE";
  template_id: string | null;
  documents_count: number;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PackSection {
  id: string;
  pack_id: string;
  title: string;
  sort: number;
}

export interface PackSectionItem {
  id: string;
  section_id: string;
  item_type: "DOC_REQUIREMENT" | "NOTE";
  key: string;
  label: string;
  required: boolean;
  guidance: string | null;
  sort: number;
}

export interface PackNarrativeSettings {
  pack_id: string;
  store_locale: string;
  include_english: boolean;
  include_store_language: boolean;
  attach_translated_customer_messages: boolean;
}

export interface PackNarrative {
  id: string;
  pack_id: string;
  locale: string;
  content: string;
  source: "USER" | "GENERATED";
  updated_at: string;
}
