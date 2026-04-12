import { getServiceClient } from "@/lib/supabase/server";
import type { DisputePhase } from "@/lib/rules/disputeReasons";
import type { ReasonTemplateMapping, ReasonMappingStats } from "@/lib/types/reasonMapping";

/**
 * List all reason-to-template mappings with joined template info.
 * Optionally filter by dispute phase.
 */
export async function listReasonMappings(
  phase?: DisputePhase
): Promise<ReasonTemplateMapping[]> {
  const sb = getServiceClient();

  let query = sb
    .from("reason_template_mappings")
    .select(
      `
      id,
      reason_code,
      dispute_phase,
      template_id,
      label,
      family,
      is_active,
      notes,
      updated_by,
      created_at,
      updated_at,
      pack_templates (
        slug,
        status,
        pack_template_i18n ( name, locale )
      )
    `
    )
    .order("reason_code")
    .order("dispute_phase");

  if (phase) {
    query = query.eq("dispute_phase", phase);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[listReasonMappings]", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    // template_id → pack_templates is a many-to-one FK, so PostgREST returns
    // a single object (not an array). Handle both shapes defensively because
    // the old code was typed as an array and still works for callers that
    // mutate the payload.
    type TplShape = {
      slug: string;
      status: string;
      pack_template_i18n: { name: string; locale: string }[];
    };
    const tplAny = row.pack_templates as unknown as
      | TplShape
      | TplShape[]
      | null;
    const tpl: TplShape | null = Array.isArray(tplAny)
      ? tplAny[0] ?? null
      : tplAny ?? null;

    const i18nName =
      tpl?.pack_template_i18n?.find((r: { locale: string }) => r.locale === "en-US")?.name ??
      tpl?.pack_template_i18n?.[0]?.name ??
      null;

    return {
      id: row.id,
      reason_code: row.reason_code,
      dispute_phase: row.dispute_phase as DisputePhase,
      template_id: row.template_id,
      label: row.label,
      family: row.family,
      is_active: row.is_active,
      notes: row.notes,
      updated_by: row.updated_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      template_name: i18nName ?? tpl?.slug ?? null,
      template_slug: tpl?.slug ?? null,
      template_status: tpl?.status ?? null,
    };
  });
}

/**
 * Update a reason mapping. Returns the row before and after for audit logging.
 */
export async function updateReasonMapping(
  id: string,
  data: {
    template_id?: string | null;
    is_active?: boolean;
    notes?: string | null;
    updated_by?: string;
  }
): Promise<{ before: Record<string, unknown> | null; after: Record<string, unknown> | null }> {
  const sb = getServiceClient();

  // Fetch before state for audit
  const { data: before } = await sb
    .from("reason_template_mappings")
    .select("*")
    .eq("id", id)
    .single();

  const update: Record<string, unknown> = {};
  if ("template_id" in data) update.template_id = data.template_id;
  if ("is_active" in data) update.is_active = data.is_active;
  if ("notes" in data) update.notes = data.notes;
  if (data.updated_by) update.updated_by = data.updated_by;

  const { data: after, error } = await sb
    .from("reason_template_mappings")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[updateReasonMapping]", error.message);
    return { before, after: null };
  }

  return { before, after };
}

/**
 * Get summary stats for reason mappings, optionally by phase.
 */
export async function getReasonMappingStats(
  phase?: DisputePhase
): Promise<ReasonMappingStats> {
  const sb = getServiceClient();

  let query = sb
    .from("reason_template_mappings")
    .select("id, template_id, is_active, pack_templates ( status )");

  if (phase) {
    query = query.eq("dispute_phase", phase);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[getReasonMappingStats]", error.message);
    return { total: 0, mapped: 0, unmapped: 0, warnings: 0 };
  }

  const rows = data ?? [];
  const total = rows.length;
  const mapped = rows.filter((r) => r.template_id != null).length;
  const unmapped = rows.filter((r) => r.template_id == null).length;
  const warnings = rows.filter((r) => {
    if (!r.template_id) return false;
    // Same many-to-one join quirk as listReasonMappings — PostgREST returns
    // pack_templates as an object, not an array.
    const tplAny = r.pack_templates as unknown as
      | { status: string }
      | { status: string }[]
      | null;
    const tpl = Array.isArray(tplAny) ? tplAny[0] ?? null : tplAny ?? null;
    return tpl?.status === "archived";
  }).length;

  return { total, mapped, unmapped, warnings };
}
