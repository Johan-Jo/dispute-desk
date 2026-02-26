export interface PackTemplate {
  id: string;
  slug: string;
  dispute_type: string;
  is_recommended: boolean;
  min_plan: string;
  created_at: string;
  updated_at: string;
}

export interface PackTemplateI18n {
  id: string;
  template_id: string;
  locale: string;
  name: string;
  short_description: string;
  works_best_for: string | null;
  preview_note: string | null;
}

export interface PackTemplateSection {
  id: string;
  template_id: string;
  title_key: string;
  title_default: string;
  sort: number;
}

export interface PackTemplateItem {
  id: string;
  template_section_id: string;
  item_type: "DOC_REQUIREMENT" | "NOTE";
  key: string;
  label_default: string;
  required: boolean;
  guidance_default: string | null;
  sort: number;
}

/** Template with resolved i18n fields, used in list responses. */
export interface TemplateListItem extends PackTemplate {
  name: string;
  short_description: string;
  works_best_for: string | null;
  preview_note: string | null;
}

/** Full template preview including sections and items. */
export interface TemplatePreview extends TemplateListItem {
  sections: (PackTemplateSection & {
    items: PackTemplateItem[];
  })[];
}
