import { getServiceClient } from "@/lib/supabase/server";
import {
  type Locale,
  DEFAULT_LOCALE,
  normalizeLocale,
} from "@/lib/i18n/locales";

export interface TemplateI18nRow {
  id: string;
  template_id: string;
  locale: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch the best-matching i18n row for a pack template.
 *
 * Resolution order:
 *   1. Exact BCP-47 match   (e.g. fr-FR)
 *   2. Base-language match   (e.g. fr  → fr-FR row)
 *   3. Default locale        (en-US)
 *   4. null if nothing found
 */
export async function getTemplateI18n(
  templateId: string,
  locale: Locale
): Promise<TemplateI18nRow | null> {
  const sb = getServiceClient();

  const { data: rows, error } = await sb
    .from("pack_template_i18n")
    .select("*")
    .eq("template_id", templateId)
    .order("locale");

  if (error) {
    console.error("[getTemplateI18n]", error.message);
    return null;
  }

  if (!rows || rows.length === 0) return null;

  const exact = rows.find((r) => r.locale === locale);
  if (exact) return exact as TemplateI18nRow;

  const baseLang = locale.split("-")[0];
  const baseMatch = rows.find((r) => {
    const normalised = normalizeLocale(r.locale);
    return normalised && normalised.split("-")[0] === baseLang;
  });
  if (baseMatch) return baseMatch as TemplateI18nRow;

  const fallback = rows.find((r) => r.locale === DEFAULT_LOCALE);
  if (fallback) return fallback as TemplateI18nRow;

  return rows[0] as TemplateI18nRow;
}

/**
 * Fetch all i18n rows for a template (admin editing).
 */
export async function getTemplateI18nAll(
  templateId: string
): Promise<TemplateI18nRow[]> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("pack_template_i18n")
    .select("*")
    .eq("template_id", templateId)
    .order("locale");

  if (error) {
    console.error("[getTemplateI18nAll]", error.message);
    return [];
  }

  return (data ?? []) as TemplateI18nRow[];
}

/**
 * Upsert an i18n translation for a template.
 */
export async function upsertTemplateI18n(
  templateId: string,
  locale: Locale,
  fields: { name: string; description?: string | null }
): Promise<TemplateI18nRow | null> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("pack_template_i18n")
    .upsert(
      {
        template_id: templateId,
        locale,
        name: fields.name,
        description: fields.description ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "template_id,locale" }
    )
    .select()
    .single();

  if (error) {
    console.error("[upsertTemplateI18n]", error.message);
    return null;
  }

  return data as TemplateI18nRow;
}
