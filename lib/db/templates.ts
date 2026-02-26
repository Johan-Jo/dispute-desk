import { getServiceClient } from "@/lib/supabase/server";
import {
  type Locale,
  DEFAULT_LOCALE,
  normalizeLocale,
} from "@/lib/i18n/locales";
import type {
  PackTemplateI18n,
  TemplateListItem,
  TemplatePreview,
  PackTemplateSection,
  PackTemplateItem,
} from "@/lib/types/templates";

/**
 * Fetch the best-matching i18n row for a pack template.
 *
 * Resolution order:
 *   1. Exact BCP-47 match   (e.g. fr-FR)
 *   2. Base-language match   (e.g. fr  -> fr-FR row)
 *   3. Default locale        (en-US)
 *   4. null if nothing found
 */
export async function getTemplateI18n(
  templateId: string,
  locale: Locale
): Promise<PackTemplateI18n | null> {
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
  if (exact) return exact as PackTemplateI18n;

  const baseLang = locale.split("-")[0];
  const baseMatch = rows.find((r) => {
    const normalised = normalizeLocale(r.locale);
    return normalised && normalised.split("-")[0] === baseLang;
  });
  if (baseMatch) return baseMatch as PackTemplateI18n;

  const fallback = rows.find((r) => r.locale === DEFAULT_LOCALE);
  if (fallback) return fallback as PackTemplateI18n;

  return rows[0] as PackTemplateI18n;
}

/**
 * List all global templates with resolved i18n fields.
 * Optionally filter by dispute_type category.
 */
export async function listTemplates(
  locale: Locale,
  category?: string
): Promise<TemplateListItem[]> {
  const sb = getServiceClient();

  let query = sb
    .from("pack_templates")
    .select("*, pack_template_i18n(*)")
    .order("is_recommended", { ascending: false })
    .order("created_at", { ascending: true });

  if (category) {
    query = query.eq("dispute_type", category);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[listTemplates]", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const i18nRows = (row.pack_template_i18n ?? []) as PackTemplateI18n[];
    const resolved = resolveI18nRow(i18nRows, locale);

    return {
      id: row.id,
      slug: row.slug,
      dispute_type: row.dispute_type,
      is_recommended: row.is_recommended,
      min_plan: row.min_plan,
      created_at: row.created_at,
      updated_at: row.updated_at,
      name: resolved?.name ?? row.slug,
      short_description: resolved?.short_description ?? "",
      works_best_for: resolved?.works_best_for ?? null,
      preview_note: resolved?.preview_note ?? null,
    };
  });
}

/**
 * Fetch full template preview: template + i18n + sections (with items).
 */
export async function getTemplatePreview(
  templateId: string,
  locale: Locale
): Promise<TemplatePreview | null> {
  const sb = getServiceClient();

  const { data: tpl, error: tplErr } = await sb
    .from("pack_templates")
    .select("*")
    .eq("id", templateId)
    .single();

  if (tplErr || !tpl) {
    console.error("[getTemplatePreview]", tplErr?.message);
    return null;
  }

  const i18n = await getTemplateI18n(templateId, locale);

  const { data: sections, error: secErr } = await sb
    .from("pack_template_sections")
    .select("*, pack_template_items(*)")
    .eq("template_id", templateId)
    .order("sort", { ascending: true });

  if (secErr) {
    console.error("[getTemplatePreview] sections", secErr.message);
    return null;
  }

  const mappedSections = (sections ?? []).map((sec) => {
    const items = ((sec.pack_template_items ?? []) as PackTemplateItem[]).sort(
      (a, b) => a.sort - b.sort
    );
    return {
      id: sec.id,
      template_id: sec.template_id,
      title_key: sec.title_key,
      title_default: sec.title_default,
      sort: sec.sort,
      items,
    } satisfies PackTemplateSection & { items: PackTemplateItem[] };
  });

  return {
    id: tpl.id,
    slug: tpl.slug,
    dispute_type: tpl.dispute_type,
    is_recommended: tpl.is_recommended,
    min_plan: tpl.min_plan,
    created_at: tpl.created_at,
    updated_at: tpl.updated_at,
    name: i18n?.name ?? tpl.slug,
    short_description: i18n?.short_description ?? "",
    works_best_for: i18n?.works_best_for ?? null,
    preview_note: i18n?.preview_note ?? null,
    sections: mappedSections,
  };
}

function resolveI18nRow(
  rows: PackTemplateI18n[],
  locale: Locale
): PackTemplateI18n | null {
  if (rows.length === 0) return null;

  const exact = rows.find((r) => r.locale === locale);
  if (exact) return exact;

  const baseLang = locale.split("-")[0];
  const baseMatch = rows.find((r) => {
    const normalised = normalizeLocale(r.locale);
    return normalised && normalised.split("-")[0] === baseLang;
  });
  if (baseMatch) return baseMatch;

  const fallback = rows.find((r) => r.locale === DEFAULT_LOCALE);
  if (fallback) return fallback;

  return rows[0];
}
