/**
 * Backfill: install inquiry-sibling packs and rewrite phase-paired rules.
 *
 * Existing shops onboarded before the silent-pairing change have chargeback
 * packs but no inquiry siblings — so inquiry-phase disputes still get the
 * heavy chargeback template at runtime. This helper walks one shop (or every
 * shop) and:
 *
 *   1. Installs the inquiry pack for every chargeback pack that has a sibling
 *      (per CHARGEBACK_TO_INQUIRY_TEMPLATE), skipping ones already installed.
 *   2. Re-runs replacePackBasedAutomationRules so the rules table picks up
 *      the new phase-paired rows — but ONLY when the shop already uses
 *      pack-based setup rules. Shops on legacy / no setup rules are left
 *      alone (the install alone is enough; the pipeline's reason_template_
 *      mappings fallback handles inquiry routing for them).
 */

import { getServiceClient } from "@/lib/supabase/server";
import {
  CHARGEBACK_TO_INQUIRY_TEMPLATE,
  INQUIRY_TEMPLATE_ID_SET,
} from "@/lib/setup/recommendTemplates";
import {
  installTemplate,
  listLibraryPacksForAutomationRules,
} from "@/lib/db/packs";

export interface BackfillShopResult {
  shopId: string;
  installedTemplateIds: string[];
  rulesRewritten: boolean;
  skipped: boolean;
  reason?: string;
}

export interface BackfillSummary {
  shopsProcessed: number;
  shopsSkipped: number;
  totalInstalled: number;
  shopsRewritten: number;
  results: BackfillShopResult[];
}

async function backfillOneShop(shopId: string): Promise<BackfillShopResult> {
  const sb = getServiceClient();

  // 1. Inventory current packs (DRAFT + ACTIVE, excludes ARCHIVED). This
  //    deliberately reads the table directly instead of going through
  //    listLibraryPacksForAutomationRules — that helper now filters inquiry
  //    packs out, but we need them in the inventory to know what's already
  //    installed.
  const { data: packsRaw } = await sb
    .from("packs")
    .select("id, template_id, status")
    .eq("shop_id", shopId)
    .neq("status", "ARCHIVED")
    .not("template_id", "is", null);

  const installedTemplateIds = new Set<string>();
  for (const p of packsRaw ?? []) {
    if (p.template_id) installedTemplateIds.add(p.template_id);
  }

  // 2. Determine which inquiry siblings are missing.
  const missing: string[] = [];
  for (const tid of installedTemplateIds) {
    if (INQUIRY_TEMPLATE_ID_SET.has(tid)) continue; // already an inquiry pack
    const sibling = CHARGEBACK_TO_INQUIRY_TEMPLATE[tid];
    if (sibling && !installedTemplateIds.has(sibling)) missing.push(sibling);
  }

  const installed: string[] = [];
  for (const templateId of missing) {
    // Backfill installs as ACTIVE — these silent siblings should be
    // immediately routable, matching how new wizard installs behave for
    // already-onboarded shops.
    const pack = await installTemplate(templateId, shopId, { activate: true });
    if (pack) installed.push(templateId);
  }

  // 3. Rules are NOT rewritten (changed 2026-07-28). This used to call
  //    `replacePackBasedAutomationRules`, whose `LIKE '__dd_setup__%'`
  //    delete removes the canonical fallback + safeguard rows — so running
  //    this admin backfill would silently disable a merchant's auto-pilot
  //    and wipe their high-value threshold.
  //
  //    Installing the sibling pack is sufficient on its own: template
  //    resolution goes through the phase-aware `reason_template_mappings`,
  //    which routes inquiry disputes correctly with no per-pack rule.
  return {
    shopId,
    installedTemplateIds: installed,
    rulesRewritten: false,
    skipped: installed.length === 0,
    reason: installed.length === 0 ? "no_missing_siblings" : undefined,
  };
}

export async function backfillInquiryPairs(
  shopId?: string,
): Promise<BackfillSummary> {
  const sb = getServiceClient();

  let shopIds: string[];
  if (shopId) {
    shopIds = [shopId];
  } else {
    const { data } = await sb.from("shops").select("id");
    shopIds = (data ?? []).map((r) => r.id as string);
  }

  const results: BackfillShopResult[] = [];
  for (const id of shopIds) {
    try {
      results.push(await backfillOneShop(id));
    } catch (err) {
      results.push({
        shopId: id,
        installedTemplateIds: [],
        rulesRewritten: false,
        skipped: true,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    shopsProcessed: results.filter((r) => !r.skipped).length,
    shopsSkipped: results.filter((r) => r.skipped).length,
    totalInstalled: results.reduce(
      (n, r) => n + r.installedTemplateIds.length,
      0,
    ),
    shopsRewritten: results.filter((r) => r.rulesRewritten).length,
    results,
  };
}
