/**
 * Backfill inquiry-sibling packs + phase-paired rules for existing shops.
 *
 * This is a thin shell around `lib/backfill/inquiryPairs.ts`. Use it when
 * you have direct DB access and want to backfill without going through the
 * admin POST endpoint.
 *
 * Requires:
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/backfill-inquiry-pairs.mjs                  # all shops
 *   node scripts/backfill-inquiry-pairs.mjs <shop-id>        # one shop
 *   node scripts/backfill-inquiry-pairs.mjs --shop=<shop-id> # one shop
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

// ── Constants mirrored from lib/setup/recommendTemplates.ts ──────────────
// Kept inline so this script doesn't need a TS build step.
const TEMPLATE_IDS = {
  fraud_standard: "a0000000-0000-0000-0000-000000000001",
  pnr_with_tracking: "a0000000-0000-0000-0000-000000000002",
  pnr_weak_proof: "a0000000-0000-0000-0000-000000000003",
  not_as_described_quality: "a0000000-0000-0000-0000-000000000004",
  subscription_canceled: "a0000000-0000-0000-0000-000000000005",
  credit_not_processed: "a0000000-0000-0000-0000-000000000006",
  duplicate_incorrect: "a0000000-0000-0000-0000-000000000007",
  digital_goods: "a0000000-0000-0000-0000-000000000008",
  policy_forward: "a0000000-0000-0000-0000-000000000009",
  general_catchall: "a0000000-0000-0000-0000-000000000010",
};
const INQUIRY_TEMPLATE_IDS = {
  fraud_inquiry: "a0000000-0000-0000-0000-000000000011",
  pnr_inquiry: "a0000000-0000-0000-0000-000000000012",
  not_as_described_inquiry: "a0000000-0000-0000-0000-000000000013",
  subscription_inquiry: "a0000000-0000-0000-0000-000000000014",
  refund_inquiry: "a0000000-0000-0000-0000-000000000015",
  duplicate_inquiry: "a0000000-0000-0000-0000-000000000016",
  policy_forward_inquiry: "a0000000-0000-0000-0000-000000000017",
  general_inquiry: "a0000000-0000-0000-0000-000000000018",
};
const INQUIRY_TEMPLATE_ID_SET = new Set(Object.values(INQUIRY_TEMPLATE_IDS));
const CHARGEBACK_TO_INQUIRY_TEMPLATE = {
  [TEMPLATE_IDS.fraud_standard]: INQUIRY_TEMPLATE_IDS.fraud_inquiry,
  [TEMPLATE_IDS.pnr_with_tracking]: INQUIRY_TEMPLATE_IDS.pnr_inquiry,
  [TEMPLATE_IDS.pnr_weak_proof]: INQUIRY_TEMPLATE_IDS.pnr_inquiry,
  [TEMPLATE_IDS.not_as_described_quality]:
    INQUIRY_TEMPLATE_IDS.not_as_described_inquiry,
  [TEMPLATE_IDS.subscription_canceled]: INQUIRY_TEMPLATE_IDS.subscription_inquiry,
  [TEMPLATE_IDS.credit_not_processed]: INQUIRY_TEMPLATE_IDS.refund_inquiry,
  [TEMPLATE_IDS.duplicate_incorrect]: INQUIRY_TEMPLATE_IDS.duplicate_inquiry,
  [TEMPLATE_IDS.policy_forward]: INQUIRY_TEMPLATE_IDS.policy_forward_inquiry,
  [TEMPLATE_IDS.general_catchall]: INQUIRY_TEMPLATE_IDS.general_inquiry,
};

const SETUP_RULE_PREFIX = "__dd_setup__:";

// ── Helpers ──────────────────────────────────────────────────────────────

async function installInquirySibling(shopId, templateId) {
  // Mirror lib/db/packs.ts → installTemplate, simplified for the backfill:
  // create the pack row + matching evidence_packs row + narrative settings.
  const { data: tpl, error: tplErr } = await sb
    .from("pack_templates")
    .select("*, pack_template_i18n(*)")
    .eq("id", templateId)
    .single();
  if (tplErr || !tpl) throw new Error(`template ${templateId} not found`);

  const i18nRows = tpl.pack_template_i18n ?? [];
  const enRow = i18nRows.find((r) => r.locale === "en-US") ?? i18nRows[0];
  const packName = enRow?.name ?? tpl.slug;

  const { data: pack, error: packErr } = await sb
    .from("packs")
    .insert({
      shop_id: shopId,
      name: packName,
      dispute_type: tpl.dispute_type,
      status: "ACTIVE",
      source: "TEMPLATE",
      template_id: templateId,
    })
    .select("*")
    .single();
  if (packErr || !pack) throw new Error(`pack insert failed: ${packErr?.message}`);

  const { error: epErr } = await sb.from("evidence_packs").insert({
    id: pack.id,
    shop_id: pack.shop_id,
    dispute_id: null,
    status: "ready",
  });
  if (epErr) throw new Error(`evidence_packs insert failed: ${epErr.message}`);

  await sb.from("pack_narrative_settings").insert({
    pack_id: pack.id,
    store_locale: "auto",
    include_english: true,
    include_store_language: true,
    attach_translated_customer_messages: false,
  });

  return pack;
}

function disputeTypeToPrimaryReason(disputeType) {
  if (disputeType === "DIGITAL") return "GENERAL";
  return disputeType || "GENERAL";
}

function packRuleName(packId) {
  return `${SETUP_RULE_PREFIX}pack:${packId}`;
}
function packInquiryRuleName(packId) {
  return `${SETUP_RULE_PREFIX}pack:${packId}:inquiry`;
}

function parsePackModesFromRules(rules) {
  // Mirrors lib/rules/normalizeMode.ts: only "auto" or "auto_pack" collapse
  // to "auto"; everything else (legacy notify/manual/review, unknown) is
  // treated as "review".
  const prefix = `${SETUP_RULE_PREFIX}pack:`;
  const out = {};
  for (const r of rules) {
    const name = r.name ?? "";
    if (!name.startsWith(prefix)) continue;
    if (name.endsWith(":inquiry")) continue;
    const id = name.slice(prefix.length);
    const raw = r.action?.mode;
    out[id] = raw === "auto" || raw === "auto_pack" ? "auto" : "review";
  }
  return out;
}

async function rewritePhasePairedRules(shopId) {
  // Pull current visible packs (chargeback only — same filter as
  // listLibraryPacksForAutomationRules).
  const { data: rawPacks } = await sb
    .from("packs")
    .select("*")
    .eq("shop_id", shopId)
    .neq("status", "ARCHIVED")
    .not("template_id", "is", null)
    .order("created_at", { ascending: true });
  const packsOrdered = (rawPacks ?? []).filter(
    (p) => !p.template_id || !INQUIRY_TEMPLATE_ID_SET.has(p.template_id),
  );

  const { data: existingRules } = await sb
    .from("rules")
    .select("*")
    .eq("shop_id", shopId)
    .like("name", `${SETUP_RULE_PREFIX}pack:%`);
  const packModes = parsePackModesFromRules(existingRules ?? []);

  // Delete all setup-prefixed rules; we'll rewrite the full set.
  await sb
    .from("rules")
    .delete()
    .eq("shop_id", shopId)
    .like("name", `${SETUP_RULE_PREFIX}%`);

  const installedTemplateIds = new Set(
    packsOrdered.map((p) => p.template_id).filter(Boolean),
  );

  const rows = [];
  for (let i = 0; i < packsOrdered.length; i++) {
    const pack = packsOrdered[i];
    const mode = packModes[pack.id] ?? "review";
    const reason = disputeTypeToPrimaryReason(pack.dispute_type);
    const priority = 20 + i * 5;
    const useAuto = mode === "auto" && pack.template_id;
    const inquirySiblingId = pack.template_id
      ? CHARGEBACK_TO_INQUIRY_TEMPLATE[pack.template_id]
      : undefined;
    const hasInquirySiblingInstalled =
      !!inquirySiblingId && installedTemplateIds.has(inquirySiblingId);

    if (useAuto) {
      rows.push({
        shop_id: shopId,
        enabled: true,
        name: packRuleName(pack.id),
        match: hasInquirySiblingInstalled
          ? { reason: [reason], phase: ["chargeback"] }
          : { reason: [reason] },
        action: { mode: "auto", pack_template_id: pack.template_id },
        priority,
      });
      if (hasInquirySiblingInstalled) {
        rows.push({
          shop_id: shopId,
          enabled: true,
          name: packInquiryRuleName(pack.id),
          match: { reason: [reason], phase: ["inquiry"] },
          action: { mode: "auto", pack_template_id: inquirySiblingId },
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
  // Catch-all fallback defaults to "review" so a dispute that matches no
  // per-reason rule still produces a pack + review email (never a silent
  // drop). Never write legacy "manual" again — the CHECK constraint on
  // rules.action->>'mode' will reject it.
  rows.push({
    shop_id: shopId,
    enabled: true,
    name: `${SETUP_RULE_PREFIX}fallback:default`,
    match: {},
    action: { mode: "review", pack_template_id: null },
    priority: 100_000,
  });

  if (rows.length > 0) {
    const { error } = await sb.from("rules").insert(rows);
    if (error) throw new Error(`rules insert failed: ${error.message}`);
  }
}

async function backfillOneShop(shopId) {
  const { data: packsRaw } = await sb
    .from("packs")
    .select("id, template_id, status")
    .eq("shop_id", shopId)
    .neq("status", "ARCHIVED")
    .not("template_id", "is", null);
  const installed = new Set();
  for (const p of packsRaw ?? []) {
    if (p.template_id) installed.add(p.template_id);
  }

  const missing = [];
  for (const tid of installed) {
    if (INQUIRY_TEMPLATE_ID_SET.has(tid)) continue;
    const sibling = CHARGEBACK_TO_INQUIRY_TEMPLATE[tid];
    if (sibling && !installed.has(sibling)) missing.push(sibling);
  }

  const installedNow = [];
  for (const templateId of missing) {
    try {
      await installInquirySibling(shopId, templateId);
      installedNow.push(templateId);
    } catch (err) {
      console.error(`  ! install ${templateId}:`, err.message);
    }
  }

  const { data: setupRules } = await sb
    .from("rules")
    .select("name")
    .eq("shop_id", shopId)
    .like("name", `${SETUP_RULE_PREFIX}pack:%`);
  const hasPackBasedSetup = (setupRules?.length ?? 0) > 0;

  let rulesRewritten = false;
  if (hasPackBasedSetup && installedNow.length > 0) {
    await rewritePhasePairedRules(shopId);
    rulesRewritten = true;
  }

  return { shopId, installed: installedNow.length, rulesRewritten };
}

// ── Main ─────────────────────────────────────────────────────────────────

const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const shopFlag = process.argv.find((a) => a.startsWith("--shop="));
const targetShopId = arg ?? (shopFlag ? shopFlag.slice("--shop=".length) : null);

let shopIds;
if (targetShopId) {
  shopIds = [targetShopId];
} else {
  const { data, error } = await sb.from("shops").select("id");
  if (error) {
    console.error("Failed to list shops:", error.message);
    process.exit(1);
  }
  shopIds = (data ?? []).map((r) => r.id);
}

console.log(`Backfilling ${shopIds.length} shop(s)...`);
let totalInstalled = 0;
let totalRewritten = 0;
for (const id of shopIds) {
  try {
    const r = await backfillOneShop(id);
    if (r.installed > 0 || r.rulesRewritten) {
      console.log(
        `  ${id}: installed ${r.installed} sibling pack(s)${
          r.rulesRewritten ? ", rewrote rules" : ""
        }`,
      );
    }
    totalInstalled += r.installed;
    if (r.rulesRewritten) totalRewritten++;
  } catch (err) {
    console.error(`  ${id}: failed —`, err.message);
  }
}
console.log(
  `Done. Installed ${totalInstalled} pack(s), rewrote rules for ${totalRewritten} shop(s).`,
);
