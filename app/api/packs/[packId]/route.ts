import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getPackById, deletePack, updatePackStatus } from "@/lib/db/packs";

interface TemplateItemRow {
  section_title: string;
  key: string;
  label: string;
  required: boolean;
  guidance: string | null;
  item_type: string;
}

/**
 * Library pack template items, localized when possible.
 *
 * When a library pack was installed from a template we read directly
 * from `pack_template_sections` + `pack_template_items` (the global
 * catalog), joining the per-locale `pack_template_section_i18n` and
 * `pack_template_item_i18n` override tables. Strings fall back to
 * `*_default` when the requested locale has no row.
 *
 * When the pack has no template_id (legacy / hand-rolled library
 * pack) we still fall back to the merchant's copied `pack_sections`
 * / `pack_section_items` rows, which are English-only.
 */
async function fetchTemplateItems(
  db: ReturnType<typeof getServiceClient>,
  packId: string,
  templateId: string | null,
  locale: string,
): Promise<TemplateItemRow[]> {
  if (templateId) {
    const { data: sections } = await db
      .from("pack_template_sections")
      .select(
        `id,
         title_default,
         sort,
         pack_template_section_i18n!pack_template_section_i18n_template_section_id_fkey(locale, title),
         pack_template_items(
           id,
           item_type,
           key,
           label_default,
           required,
           guidance_default,
           sort,
           pack_template_item_i18n!pack_template_item_i18n_template_item_id_fkey(locale, label, guidance)
         )`,
      )
      .eq("template_id", templateId)
      .order("sort", { ascending: true });

    const items: TemplateItemRow[] = [];
    for (const sec of sections ?? []) {
      const secAny = sec as {
        title_default: string;
        pack_template_section_i18n?: Array<{ locale: string; title: string }>;
        pack_template_items?: Array<{
          item_type: string;
          key: string;
          label_default: string;
          required: boolean;
          guidance_default: string | null;
          sort: number;
          pack_template_item_i18n?: Array<{
            locale: string;
            label: string;
            guidance: string | null;
          }>;
        }>;
      };
      const secLocale = secAny.pack_template_section_i18n?.find(
        (r) => r.locale === locale,
      );
      const sectionTitle = secLocale?.title ?? secAny.title_default;

      const rawItems = secAny.pack_template_items ?? [];
      const sorted = [...rawItems].sort((a, b) => a.sort - b.sort);
      for (const it of sorted) {
        const itLocale = it.pack_template_item_i18n?.find(
          (r) => r.locale === locale,
        );
        items.push({
          section_title: sectionTitle,
          key: it.key,
          label: itLocale?.label ?? it.label_default,
          required: it.required,
          guidance: itLocale?.guidance ?? it.guidance_default,
          item_type: it.item_type,
        });
      }
    }
    return items;
  }

  // Fallback: legacy / hand-rolled library pack without a template link.
  // Uses the merchant's copied pack_sections/pack_section_items, which
  // don't have localization support — text stays in whatever language
  // was copied at install time.
  const { data: sections } = await db
    .from("pack_sections")
    .select(
      "id, title, sort, pack_section_items(id, item_type, key, label, required, guidance, sort)",
    )
    .eq("pack_id", packId)
    .order("sort", { ascending: true });

  const items: TemplateItemRow[] = [];
  for (const sec of sections ?? []) {
    const rawItems = (
      sec as { pack_section_items?: Array<{
        item_type: string;
        key: string;
        label: string;
        required: boolean;
        guidance: string | null;
        sort: number;
      }> }
    ).pack_section_items ?? [];
    const sorted = [...rawItems].sort((a, b) => a.sort - b.sort);
    for (const it of sorted) {
      items.push({
        section_title: (sec as { title: string }).title,
        key: it.key,
        label: it.label,
        required: it.required,
        guidance: it.guidance,
        item_type: it.item_type,
      });
    }
  }
  return items;
}

async function resolveTemplateName(
  db: ReturnType<typeof getServiceClient>,
  templateId: string,
  locale: string,
): Promise<string | null> {
  // Try the requested locale first, then en-US, then any row.
  const { data: rows } = await db
    .from("pack_template_i18n")
    .select("name, locale")
    .eq("template_id", templateId);
  const list = rows ?? [];
  const exact = list.find((r) => r.locale === locale);
  if (exact) return exact.name;
  const english = list.find((r) => r.locale === "en-US");
  if (english) return english.name;
  return list[0]?.name ?? null;
}

interface StoredChecklistItem {
  field: string;
  label: string;
  required: boolean;
  present: boolean;
}

/**
 * Re-materialize localized labels on a dispute pack's cached
 * checklist. buildPack stores `label_default` (English) when it
 * writes pack_json.checklist, so rendering those strings directly
 * leaks English to non-English merchants. At read time we look up
 * each item's live pack_template_item_i18n row for the requested
 * locale and substitute. If the item has no matching template row
 * (e.g. a REASON_TEMPLATES fallback field that isn't in the
 * template), the English label stays.
 */
async function localizeChecklist(
  db: ReturnType<typeof getServiceClient>,
  templateId: string | null,
  checklist: StoredChecklistItem[] | null,
  locale: string,
): Promise<StoredChecklistItem[] | null> {
  if (!checklist || checklist.length === 0 || !templateId) return checklist;

  const { data: items } = await db
    .from("pack_template_items")
    .select(
      `key,
       label_default,
       pack_template_section_id: template_section_id,
       pack_template_item_i18n!pack_template_item_i18n_template_item_id_fkey(locale, label)`,
    )
    .in(
      "template_section_id",
      (
        await db
          .from("pack_template_sections")
          .select("id")
          .eq("template_id", templateId)
      ).data?.map((s) => (s as { id: string }).id) ?? [],
    );

  if (!items?.length) return checklist;

  // Build a lookup: item key (or label_default) → localized label.
  const byKey = new Map<string, string>();
  for (const raw of items) {
    const r = raw as {
      key: string;
      label_default: string;
      pack_template_item_i18n?: Array<{ locale: string; label: string }>;
    };
    const localized = r.pack_template_item_i18n?.find(
      (x) => x.locale === locale,
    );
    const label = localized?.label ?? r.label_default;
    byKey.set(r.key, label);
    // Also index by label_default so fallback labels that don't
    // carry a matching key (e.g. REASON_TEMPLATES fields stored by
    // their collector string) still resolve if the English text
    // happens to match.
    byKey.set(r.label_default, label);
  }

  return checklist.map((item) => {
    const localizedLabel =
      byKey.get(item.field) ?? byKey.get(item.label) ?? item.label;
    return { ...item, label: localizedLabel };
  });
}

/**
 * For dispute packs, resolve the effective template id. Prefers
 * evidence_packs.pack_template_id (set when a rule explicitly
 * picked a template), then falls back to the default mapping in
 * reason_template_mappings (set by the admin + backfilled by the
 * audit work in commit 8a6bf59). Returns null only when neither
 * source has a template — in that case the cached label_default
 * English strings stay.
 */
async function resolveDisputePackTemplateId(
  db: ReturnType<typeof getServiceClient>,
  pack: { pack_template_id?: string | null },
  disputeReason: string | null,
  disputePhase: string | null,
): Promise<string | null> {
  if (pack.pack_template_id) return pack.pack_template_id;
  if (!disputeReason || !disputePhase) return null;
  const { data: mapping } = await db
    .from("reason_template_mappings")
    .select("template_id")
    .eq("reason_code", disputeReason)
    .eq("dispute_phase", disputePhase)
    .maybeSingle();
  return (mapping as { template_id?: string } | null)?.template_id ?? null;
}

/**
 * GET /api/packs/:packId
 *
 * Returns pack with evidence items, checklist, audit log, and active job status.
 * If the id is not in evidence_packs (e.g. template-installed library pack), falls back
 * to the packs table and returns a compatible shape with empty evidence/jobs.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const db = getServiceClient();
  const locale = req?.nextUrl?.searchParams?.get("locale") ?? "en-US";

  const { data: row, error } = await db
    .from("evidence_packs")
    .select("*, shop:shops(shop_domain), dispute:disputes(dispute_gid, dispute_evidence_gid, phase, reason)")
    .eq("id", packId)
    .single();

  if (!error && row) {
    const shop = Array.isArray((row as { shop?: unknown }).shop)
      ? (row as { shop: { shop_domain?: string }[] }).shop[0]
      : (row as { shop?: { shop_domain?: string } }).shop;
    const disputeRow = Array.isArray((row as { dispute?: unknown }).dispute)
      ? (row as { dispute: { dispute_gid?: string; dispute_evidence_gid?: string; phase?: string; reason?: string }[] }).dispute[0]
      : (row as { dispute?: { dispute_gid?: string; dispute_evidence_gid?: string; phase?: string; reason?: string } }).dispute;
    const shop_domain = shop?.shop_domain ?? null;
    const dispute_gid = disputeRow?.dispute_gid ?? null;
    const dispute_evidence_gid = disputeRow?.dispute_evidence_gid ?? null;
    const dispute_phase = disputeRow?.phase ?? null;
    const dispute_reason = disputeRow?.reason ?? null;
    const { shop: _shop, dispute: _dispute, ...pack } = row as typeof row & { shop?: unknown; dispute?: unknown };

    // Library packs (dispute_id null): merge name, dispute_type, source, template_id, template_name from packs
    // and load template items (sections + items copied from the template on install) so the
    // embedded UI can render a real read-only preview instead of a hardcoded fallback list.
    let libraryTemplateId: string | null = null;
    if (pack.dispute_id == null) {
      const { data: libraryRow } = await db
        .from("packs")
        .select("name, dispute_type, source, template_id")
        .eq("id", packId)
        .single();
      if (libraryRow) {
        (pack as Record<string, unknown>).dispute_type = libraryRow.dispute_type;
        (pack as Record<string, unknown>).source = libraryRow.source;
        (pack as Record<string, unknown>).template_id = libraryRow.template_id;
        libraryTemplateId = libraryRow.template_id ?? null;
        if (libraryRow.template_id) {
          const localizedName = await resolveTemplateName(
            db,
            libraryRow.template_id,
            locale,
          );
          (pack as Record<string, unknown>).template_name = localizedName;
          (pack as Record<string, unknown>).name = localizedName ?? libraryRow.name;
        } else {
          (pack as Record<string, unknown>).name = libraryRow.name;
        }
      }
      (pack as Record<string, unknown>).template_items = await fetchTemplateItems(
        db,
        packId,
        libraryTemplateId,
        locale,
      );
    }

    // Dispute packs: re-materialize localized checklist labels.
    // buildPack caches label_default (English) in pack_json.checklist;
    // we look up the live pack_template_item_i18n row for the caller's
    // locale and substitute. Falls through when there's no template
    // to key off (the English labels stay as a last-resort fallback).
    if (pack.dispute_id != null) {
      const effectiveTemplateId = await resolveDisputePackTemplateId(
        db,
        pack as { pack_template_id?: string | null },
        dispute_reason,
        dispute_phase,
      );
      if (effectiveTemplateId) {
        (pack as Record<string, unknown>).checklist = await localizeChecklist(
          db,
          effectiveTemplateId,
          pack.checklist as StoredChecklistItem[] | null,
          locale,
        );
      }
    }

    const [itemsRes, auditRes, buildJobRes, pdfJobRes] = await Promise.all([
      db
        .from("evidence_items")
        .select("*")
        .eq("pack_id", packId)
        .order("created_at", { ascending: true }),
      db
        .from("audit_events")
        .select("id, event_type, event_payload, actor_type, created_at")
        .eq("pack_id", packId)
        .order("created_at", { ascending: true }),
      db
        .from("jobs")
        .select("id, status, last_error, created_at, updated_at")
        .eq("entity_id", packId)
        .eq("job_type", "build_pack")
        .in("status", ["queued", "running"])
        .limit(1)
        .maybeSingle(),
      db
        .from("jobs")
        .select("id, status, last_error, created_at, updated_at")
        .eq("entity_id", packId)
        .eq("job_type", "render_pdf")
        .in("status", ["queued", "running"])
        .limit(1)
        .maybeSingle(),
    ]);

    return NextResponse.json({
      ...pack,
      shop_domain,
      dispute_gid,
      dispute_evidence_gid,
      dispute_phase,
      evidence_items: itemsRes.data ?? [],
      audit_events: auditRes.data ?? [],
      active_build_job: buildJobRes.data ?? null,
      active_pdf_job: pdfJobRes.data ?? null,
    });
  }

  // Fallback: library pack (packs table) e.g. from template install
  const libraryPack = await getPackById(packId);
  if (!libraryPack) {
    // Pack is in neither evidence_packs nor packs (e.g. wrong ID or different environment DB)
    return NextResponse.json(
      { error: "Pack not found. If this pack was just created, ensure you're on the same environment (e.g. production DB)." },
      { status: 404 }
    );
  }

  const { shop_domain, template_id, ...rest } = libraryPack as typeof libraryPack & { template_id?: string | null };
  let template_name: string | null = null;
  if (template_id) {
    template_name = await resolveTemplateName(db, template_id, locale);
  }

  const fallbackTemplateItems = await fetchTemplateItems(
    db,
    packId,
    template_id ?? null,
    locale,
  );

  return NextResponse.json({
    ...rest,
    template_id: template_id ?? null,
    template_name,
    dispute_id: null,
    completeness_score: null,
    checklist: null,
    checklist_v2: null,
    submission_readiness: null,
    waived_items: [],
    blockers: null,
    recommended_actions: null,
    pack_json: null,
    pdf_path: null,
    saved_to_shopify_at: null,
    created_by: null,
    shop_domain: shop_domain ?? null,
    dispute_gid: null,
    dispute_evidence_gid: null,
    dispute_phase: null,
    evidence_items: [],
    audit_events: [],
    active_build_job: null,
    active_pdf_job: null,
    template_items: fallbackTemplateItems,
  });
}

/**
 * PATCH /api/packs/:packId
 *
 * Body: { status: "DRAFT" | "ACTIVE" | "ARCHIVED" }
 *
 * Updates a library pack's status (e.g. activate a draft template pack).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const status = body?.status;
  if (!status || !["DRAFT", "ACTIVE", "ARCHIVED"].includes(status)) {
    return NextResponse.json(
      { error: "status must be one of: DRAFT, ACTIVE, ARCHIVED" },
      { status: 400 }
    );
  }
  const pack = await updatePackStatus(packId, status as "DRAFT" | "ACTIVE" | "ARCHIVED");
  if (!pack) {
    return NextResponse.json({ error: "Pack not found or could not be updated" }, { status: 404 });
  }
  return NextResponse.json(pack);
}

/**
 * DELETE /api/packs/:packId
 *
 * Deletes a library pack (must exist in packs table). Unlinks audit_events,
 * removes evidence_packs row, then deletes pack (cascade removes sections, narratives).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  const { packId } = await params;
  const deleted = await deletePack(packId);
  if (!deleted) {
    return NextResponse.json({ error: "Pack not found or could not be deleted" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
