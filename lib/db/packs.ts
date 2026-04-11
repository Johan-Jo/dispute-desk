import { getServiceClient } from "@/lib/supabase/server";
import type { Pack, PackNarrativeSettings, PackNarrative } from "@/lib/types/packs";
import { INQUIRY_TEMPLATE_ID_SET } from "@/lib/setup/recommendTemplates";

// Uses Shopify dispute reason codes directly after migration
// 20260411160000. DIGITAL is retained as a product-type signal
// with no Shopify equivalent.
const DISPUTE_TYPE_LABELS: Record<string, string> = {
  FRAUDULENT: "Fraudulent transaction",
  PRODUCT_NOT_RECEIVED: "Product not received",
  PRODUCT_UNACCEPTABLE: "Product not as described",
  SUBSCRIPTION_CANCELED: "Subscription",
  CREDIT_NOT_PROCESSED: "Refund/credit not processed",
  DUPLICATE: "Duplicate/incorrect amount",
  DIGITAL: "Digital goods/service",
  GENERAL: "General",
};

/**
 * Install a global template as a shop-bound pack.
 *
 * Copies template structure (sections + items) into pack_sections / pack_section_items,
 * creates default narrative settings, and generates skeleton English narrative.
 */
export async function installTemplate(
  templateId: string,
  shopId: string,
  options?: { name?: string; activate?: boolean }
): Promise<Pack | null> {
  const sb = getServiceClient();
  const activate = options?.activate === true;

  // 1. Fetch template + i18n for default name
  const { data: tpl, error: tplErr } = await sb
    .from("pack_templates")
    .select("*, pack_template_i18n(*)")
    .eq("id", templateId)
    .single();

  if (tplErr || !tpl) {
    console.error("[installTemplate] template not found", tplErr?.message);
    return null;
  }

  const i18nRows = (tpl.pack_template_i18n ?? []) as Array<{
    locale: string;
    name: string;
  }>;
  const enRow = i18nRows.find((r) => r.locale === "en-US") ?? i18nRows[0];
  const packName = options?.name ?? enRow?.name ?? tpl.slug;

  // 2. Create pack
  const { data: pack, error: packErr } = await sb
    .from("packs")
    .insert({
      shop_id: shopId,
      name: packName,
      dispute_type: tpl.dispute_type,
      status: activate ? "ACTIVE" : "DRAFT",
      source: "TEMPLATE",
      template_id: templateId,
    })
    .select("*")
    .single();

  if (packErr || !pack) {
    console.error("[installTemplate] pack insert", packErr?.message);
    return null;
  }

  // 2b. Create matching evidence_packs row so uploads and evidence_items work (dispute_id NULL for library packs)
  const { error: epErr } = await sb.from("evidence_packs").insert({
    id: pack.id,
    shop_id: pack.shop_id,
    dispute_id: null,
    status: activate ? "ready" : "draft",
  });
  if (epErr) {
    console.error("[installTemplate] evidence_packs insert", epErr?.message);
    return null;
  }

  // 3. Fetch template sections + items (used only to seed the
  //    skeleton narrative — we no longer copy these into
  //    pack_sections / pack_section_items. The API path at
  //    /api/packs/:id now reads pack_template_sections and
  //    pack_template_items directly with locale joins, so the
  //    per-merchant copies were dead data. Cleanup migration
  //    20260411170000 deletes the stale existing rows.
  const { data: tplSections } = await sb
    .from("pack_template_sections")
    .select("*, pack_template_items(*)")
    .eq("template_id", templateId)
    .order("sort", { ascending: true });

  const requiredItemLabels: string[] = [];
  for (const sec of tplSections ?? []) {
    const items = (
      (
        sec as {
          pack_template_items?: Array<{ label_default: string; required: boolean }>;
        }
      ).pack_template_items ?? []
    ) as Array<{ label_default: string; required: boolean }>;
    for (const it of items) {
      if (it.required) requiredItemLabels.push(it.label_default);
    }
  }

  // 5. Create default narrative settings
  await sb.from("pack_narrative_settings").insert({
    pack_id: pack.id,
    store_locale: "auto",
    include_english: true,
    include_store_language: true,
    attach_translated_customer_messages: false,
  });

  // 6. Generate skeleton English narrative
  const typeLabel = DISPUTE_TYPE_LABELS[tpl.dispute_type] ?? tpl.dispute_type;
  const evidenceBullets = requiredItemLabels
    .slice(0, 5)
    .map((label) => `- ${label}`)
    .join("\n");

  const skeleton = [
    `${typeLabel} dispute filed on [DATE]. The merchant provides the following evidence demonstrating the charge is valid.`,
    "",
    "Timeline:",
    "- [Order date]",
    "- [Fulfillment/shipping date]",
    "- [Delivery confirmation date]",
    "",
    "Key evidence:",
    evidenceBullets || "- [Evidence items]",
    "",
    "This evidence package supports the merchant's position that the transaction was legitimate and fulfilled as described.",
  ].join("\n");

  await sb.from("pack_narratives").insert({
    pack_id: pack.id,
    locale: "en-US",
    content: skeleton,
    source: "GENERATED",
  });

  return pack as Pack;
}

/**
 * Fetch a single pack by id from the library (packs) table.
 * Returns null if not found. Used by GET /api/packs/[packId] fallback when the pack
 * is not an evidence_pack (e.g. template-installed pack).
 */
export async function getPackById(packId: string): Promise<(Pack & { shop_domain?: string | null }) | null> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("packs")
    .select("*, shop:shops(shop_domain)")
    .eq("id", packId)
    .single();

  if (error || !data) {
    return null;
  }

  const shop = Array.isArray((data as { shop?: unknown }).shop)
    ? (data as { shop: { shop_domain?: string }[] }).shop[0]
    : (data as { shop?: { shop_domain?: string } }).shop;
  const shop_domain = shop?.shop_domain ?? null;
  const { shop: _shop, ...pack } = data as typeof data & { shop?: unknown };
  return { ...pack, shop_domain } as Pack & { shop_domain: string | null };
}

/** Fetch all packs for a shop with optional status filter. */
/** Distinct global template IDs the shop has installed as library packs. */
export async function listInstalledTemplateIdsForShop(
  shopId: string
): Promise<string[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("packs")
    .select("template_id")
    .eq("shop_id", shopId)
    .not("template_id", "is", null);

  if (error) {
    console.error("[listInstalledTemplateIdsForShop]", error.message);
    return [];
  }

  const ids = new Set<string>();
  for (const row of data ?? []) {
    const tid = (row as { template_id?: string | null }).template_id;
    if (tid) ids.add(tid);
  }
  return [...ids];
}

export async function listPacks(
  shopId: string,
  opts?: { status?: string; search?: string }
): Promise<Pack[]> {
  const sb = getServiceClient();

  let query = sb
    .from("packs")
    .select("*")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });

  if (opts?.status && opts.status !== "all") {
    query = query.eq("status", opts.status);
  }

  if (opts?.search) {
    query = query.or(
      `name.ilike.%${opts.search}%,dispute_type.ilike.%${opts.search}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error("[listPacks]", error.message);
    return [];
  }

  return (data ?? []) as Pack[];
}

/**
 * Template-backed library packs for automation setup: **DRAFT and ACTIVE** (excludes ARCHIVED).
 * Oldest first = rule priority. Aligns with “installed templates” on the Packs step; many installs
 * stay DRAFT until explicitly activated, so filtering only ACTIVE hid most packs on Auto e revisão.
 *
 * Inquiry-phase packs (the silent siblings of chargeback packs) are excluded
 * here so the merchant only sees one row per dispute family in the wizard /
 * Automation rules page. Routing for inquiries is handled invisibly via the
 * phase-paired rules written by `replacePackBasedAutomationRules`.
 */
export async function listLibraryPacksForAutomationRules(
  shopId: string
): Promise<Pack[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("packs")
    .select("*")
    .eq("shop_id", shopId)
    .neq("status", "ARCHIVED")
    .not("template_id", "is", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[listLibraryPacksForAutomationRules]", error.message);
    return [];
  }
  return ((data ?? []) as Pack[]).filter(
    (p) => !p.template_id || !INQUIRY_TEMPLATE_ID_SET.has(p.template_id)
  );
}

/** Create a manual (non-template) pack. */
export async function createPack(
  shopId: string,
  fields: { name: string; disputeType: string; code?: string; description?: string }
): Promise<Pack | null> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("packs")
    .insert({
      shop_id: shopId,
      name: fields.name,
      dispute_type: fields.disputeType,
      code: fields.code ?? null,
      description: fields.description ?? null,
      status: "DRAFT",
      source: "MANUAL",
    })
    .select("*")
    .single();

  if (error) {
    console.error("[createPack]", error.message);
    return null;
  }

  // Create default narrative settings for manual packs too
  await sb.from("pack_narrative_settings").insert({
    pack_id: data.id,
    store_locale: "auto",
    include_english: true,
    include_store_language: true,
    attach_translated_customer_messages: false,
  });

  return data as Pack;
}

/**
 * Delete a library pack by id. Unlinks audit_events, then deletes evidence_packs
 * and packs (cascade removes pack_sections, pack_narratives, etc.).
 * Returns true if a pack was deleted, false if not found or error.
 */
export async function deletePack(packId: string): Promise<boolean> {
  const sb = getServiceClient();

  const { data: packRow } = await sb
    .from("packs")
    .select("id")
    .eq("id", packId)
    .single();

  if (!packRow) {
    return false;
  }

  await sb.from("audit_events").update({ pack_id: null }).eq("pack_id", packId);
  await sb.from("evidence_packs").delete().eq("id", packId);
  const { error: packErr } = await sb.from("packs").delete().eq("id", packId);

  if (packErr) {
    console.error("[deletePack]", packErr.message);
    return false;
  }
  return true;
}

const PACK_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;

/**
 * Update a library pack's status (packs table). Used when user activates a draft pack.
 * Optionally syncs evidence_packs.status for library packs (draft → ready when ACTIVE).
 */
export async function updatePackStatus(
  packId: string,
  status: "DRAFT" | "ACTIVE" | "ARCHIVED"
): Promise<Pack | null> {
  if (!PACK_STATUSES.includes(status)) {
    return null;
  }
  const sb = getServiceClient();

  const { data: pack, error: packErr } = await sb
    .from("packs")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packId)
    .select("*")
    .single();

  if (packErr || !pack) {
    console.error("[updatePackStatus]", packErr?.message);
    return null;
  }

  // Keep evidence_packs in sync for library packs (dispute_id is null)
  const epStatus = status === "ACTIVE" ? "ready" : status === "ARCHIVED" ? "archived" : "draft";
  await sb
    .from("evidence_packs")
    .update({ status: epStatus, updated_at: new Date().toISOString() })
    .eq("id", packId)
    .is("dispute_id", null);

  return pack as Pack;
}

export async function getPackNarrativeSettings(
  packId: string
): Promise<PackNarrativeSettings | null> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("pack_narrative_settings")
    .select("*")
    .eq("pack_id", packId)
    .single();

  if (error) {
    console.error("[getPackNarrativeSettings]", error.message);
    return null;
  }

  return data as PackNarrativeSettings;
}

export async function updatePackNarrativeSettings(
  packId: string,
  settings: Partial<Omit<PackNarrativeSettings, "pack_id">>
): Promise<PackNarrativeSettings | null> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("pack_narrative_settings")
    .upsert(
      { pack_id: packId, ...settings },
      { onConflict: "pack_id" }
    )
    .select("*")
    .single();

  if (error) {
    console.error("[updatePackNarrativeSettings]", error.message);
    return null;
  }

  return data as PackNarrativeSettings;
}

export async function getPackNarratives(
  packId: string
): Promise<PackNarrative[]> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("pack_narratives")
    .select("*")
    .eq("pack_id", packId)
    .order("locale");

  if (error) {
    console.error("[getPackNarratives]", error.message);
    return [];
  }

  return (data ?? []) as PackNarrative[];
}

export async function upsertPackNarrative(
  packId: string,
  locale: string,
  content: string
): Promise<PackNarrative | null> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("pack_narratives")
    .upsert(
      {
        pack_id: packId,
        locale,
        content,
        source: "USER",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "pack_id,locale" }
    )
    .select("*")
    .single();

  if (error) {
    console.error("[upsertPackNarrative]", error.message);
    return null;
  }

  return data as PackNarrative;
}
