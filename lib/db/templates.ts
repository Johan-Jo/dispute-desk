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

/* ── Admin-facing queries ────────────────────────────────────────────── */

interface AdminTemplateRow {
  id: string;
  slug: string;
  dispute_type: string;
  is_recommended: boolean;
  min_plan: string;
  status: string;
  created_at: string;
  updated_at: string;
  name: string;
  short_description: string;
  locale_count: number;
  usage_count: number;
  mapping_count: number;
}

/**
 * List all global templates with admin-facing metadata:
 * usage count, locale count, mapping count, status.
 */
export async function listTemplatesAdmin(): Promise<AdminTemplateRow[]> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("pack_templates")
    .select("*, pack_template_i18n(*)")
    .order("is_recommended", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[listTemplatesAdmin]", error.message);
    return [];
  }

  // Get mapping counts per template
  const { data: mappingRows } = await sb
    .from("reason_template_mappings")
    .select("template_id");

  const mappingCounts = new Map<string, number>();
  for (const r of mappingRows ?? []) {
    if (r.template_id) {
      mappingCounts.set(r.template_id, (mappingCounts.get(r.template_id) ?? 0) + 1);
    }
  }

  return (data ?? []).map((row) => {
    const i18nRows = (row.pack_template_i18n ?? []) as PackTemplateI18n[];
    const resolved = resolveI18nRow(i18nRows, DEFAULT_LOCALE);

    return {
      id: row.id,
      slug: row.slug,
      dispute_type: row.dispute_type,
      is_recommended: row.is_recommended,
      min_plan: row.min_plan,
      status: row.status ?? "active",
      created_at: row.created_at,
      updated_at: row.updated_at,
      name: resolved?.name ?? row.slug,
      short_description: resolved?.short_description ?? "",
      locale_count: i18nRows.length,
      usage_count: 0, // TODO: compute from evidence_packs if needed
      mapping_count: mappingCounts.get(row.id) ?? 0,
    };
  });
}

/**
 * Update a template's status. Returns before/after for audit.
 */
export async function updateTemplateStatus(
  id: string,
  status: "active" | "draft" | "archived"
): Promise<{ before: Record<string, unknown> | null; after: Record<string, unknown> | null }> {
  const sb = getServiceClient();

  const { data: before } = await sb
    .from("pack_templates")
    .select("*")
    .eq("id", id)
    .single();

  const { data: after, error } = await sb
    .from("pack_templates")
    .update({ status })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[updateTemplateStatus]", error.message);
    return { before, after: null };
  }

  return { before, after };
}

interface HealthIssue {
  severity: "critical" | "warning" | "info";
  type: string;
  message: string;
  target_id?: string;
  target_label?: string;
  fix_path?: string;
}

/**
 * Detect template health issues for admin governance.
 */
export async function getTemplateHealthIssues(): Promise<HealthIssue[]> {
  const sb = getServiceClient();
  const issues: HealthIssue[] = [];

  // Get all templates
  const { data: templates } = await sb
    .from("pack_templates")
    .select("id, slug, status, pack_template_i18n(locale), pack_template_sections(id)");

  // Get all mappings
  const { data: mappings } = await sb
    .from("reason_template_mappings")
    .select("reason_code, dispute_phase, template_id, pack_templates(status)");

  // Check unmapped reasons
  for (const m of mappings ?? []) {
    if (!m.template_id) {
      issues.push({
        severity: "critical",
        type: "unmapped_reason",
        message: `${m.reason_code} (${m.dispute_phase}) has no default template`,
        target_label: `${m.reason_code} / ${m.dispute_phase}`,
        fix_path: "/admin/reason-mapping",
      });
    }
  }

  // Check mappings pointing to archived templates
  for (const m of mappings ?? []) {
    if (m.template_id) {
      const tplArr = m.pack_templates as unknown as { status: string }[] | null;
      if (tplArr?.[0]?.status === "archived") {
        issues.push({
          severity: "critical",
          type: "archived_mapping",
          message: `${m.reason_code} (${m.dispute_phase}) maps to an archived template`,
          target_label: `${m.reason_code} / ${m.dispute_phase}`,
          fix_path: "/admin/reason-mapping",
        });
      }
    }
  }

  for (const t of templates ?? []) {
    const i18nRows = (t.pack_template_i18n ?? []) as { locale: string }[];
    const sections = (t.pack_template_sections ?? []) as { id: string }[];

    // Templates with no sections
    if (sections.length === 0 && (t.status === "active")) {
      issues.push({
        severity: "warning",
        type: "no_sections",
        message: `Template "${t.slug}" has no sections defined`,
        target_id: t.id,
        target_label: t.slug,
        fix_path: `/admin/templates/${t.id}`,
      });
    }

    // Templates with only one locale
    if (i18nRows.length <= 1 && t.status === "active") {
      issues.push({
        severity: "warning",
        type: "missing_locales",
        message: `Template "${t.slug}" has only ${i18nRows.length} locale(s)`,
        target_id: t.id,
        target_label: t.slug,
        fix_path: `/admin/templates/${t.id}`,
      });
    }

    // Draft templates
    if (t.status === "draft") {
      issues.push({
        severity: "info",
        type: "draft_template",
        message: `Template "${t.slug}" is in draft status`,
        target_id: t.id,
        target_label: t.slug,
        fix_path: `/admin/templates/${t.id}`,
      });
    }
  }

  return issues;
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
