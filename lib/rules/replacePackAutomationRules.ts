import { getServiceClient } from "@/lib/supabase/server";
import type { Pack } from "@/lib/types/packs";
import { SETUP_RULE_PREFIX } from "@/lib/rules/setupAutomation";
import type { Rule } from "@/lib/rules/types";
import {
  disputeTypeToPrimaryReason,
  packRuleName,
  packInquiryRuleName,
  type PackHandlingUiMode,
} from "@/lib/rules/packHandlingAutomation";
import { CHARGEBACK_TO_INQUIRY_TEMPLATE } from "@/lib/setup/recommendTemplates";

const FALLBACK_RULE_NAME = `${SETUP_RULE_PREFIX}fallback:default`;

function buildPackAndFallbackRules(
  shopId: string,
  packsOrdered: Pack[],
  packModes: Record<string, PackHandlingUiMode>
): Array<Omit<Rule, "id" | "created_at" | "updated_at">> {
  const rows: Array<Omit<Rule, "id" | "created_at" | "updated_at">> = [];

  // Inquiry sibling templates that the merchant has installed (silently
  // paired during the Coverage step). Used to write phase-aware rules.
  const installedInquiryTemplateIds = new Set(
    packsOrdered
      .map((p) => p.template_id)
      .filter((id): id is string => Boolean(id))
  );

  for (let i = 0; i < packsOrdered.length; i++) {
    const pack = packsOrdered[i];
    const mode: PackHandlingUiMode = packModes[pack.id] ?? "review";
    const reason = disputeTypeToPrimaryReason(pack.dispute_type);
    const priority = 20 + i * 5;
    const useAuto = mode === "auto" && pack.template_id;
    const inquirySiblingId = pack.template_id
      ? CHARGEBACK_TO_INQUIRY_TEMPLATE[pack.template_id]
      : undefined;
    const hasInquirySiblingInstalled =
      !!inquirySiblingId && installedInquiryTemplateIds.has(inquirySiblingId);

    if (useAuto) {
      // Chargeback-phase rule. If we have an inquiry sibling installed we
      // restrict this rule to the chargeback phase so the inquiry rule
      // (written next) can take over for inquiry disputes.
      rows.push({
        shop_id: shopId,
        enabled: true,
        name: packRuleName(pack.id),
        match: hasInquirySiblingInstalled
          ? { reason: [reason], phase: ["chargeback"] }
          : { reason: [reason] },
        action: {
          mode: "auto",
          pack_template_id: pack.template_id!,
        },
        priority,
      });

      if (hasInquirySiblingInstalled) {
        rows.push({
          shop_id: shopId,
          enabled: true,
          name: packInquiryRuleName(pack.id),
          match: { reason: [reason], phase: ["inquiry"] },
          action: {
            mode: "auto",
            pack_template_id: inquirySiblingId!,
          },
          priority,
        });
      }
    } else {
      rows.push({
        shop_id: shopId,
        enabled: true,
        name: packRuleName(pack.id),
        match: { reason: [reason] },
        action: { mode: "review", pack_template_id: null },
        priority,
      });
    }
  }
  // Catch-all fallback — no rule matched means "prepare a pack, let the
  // merchant approve". Never silently drop.
  rows.push({
    shop_id: shopId,
    enabled: true,
    name: FALLBACK_RULE_NAME,
    match: {},
    action: { mode: "review", pack_template_id: null },
    priority: 100_000,
  });
  return rows;
}

/**
 * Replaces all setup-prefixed rules with pack-based rules + default fallback.
 */
export async function replacePackBasedAutomationRules(
  shopId: string,
  packsOrdered: Pack[],
  packModes: Record<string, PackHandlingUiMode>
): Promise<void> {
  const sb = getServiceClient();

  await sb
    .from("rules")
    .delete()
    .eq("shop_id", shopId)
    .like("name", `${SETUP_RULE_PREFIX}%`);

  const rows = buildPackAndFallbackRules(shopId, packsOrdered, packModes);
  if (rows.length === 0) return;

  const { error } = await sb.from("rules").insert(
    rows.map((r) => ({
      shop_id: r.shop_id,
      enabled: r.enabled,
      name: r.name,
      match: r.match,
      action: r.action,
      priority: r.priority,
    }))
  );

  if (error) throw new Error(error.message);
}
