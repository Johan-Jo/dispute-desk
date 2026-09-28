/**
 * Not-as-described plan PR 4 — the flag-ON replay. READ-ONLY.
 *
 * For every open not-as-described dispute with a pack: ask Shopify (read-only
 * query, nothing stored) whether the collector would find a listing, then
 * compute — from the SAME inputs, flag OFF vs ON — the completeness score,
 * readiness, the letter's package mode, and the shop's auto-save gate. Also
 * counts the letters that would go stale (a new fact means a rebuild).
 *
 *   npx tsx scripts/evidence-model/productListingFlagOn.replay.mts --env-file .env.production.local --out <file.md>
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { config } from "dotenv";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const envFile = arg("env-file");
const out = arg("out");
if (!envFile || !out) {
  console.error("usage: --env-file <f> --out <file.md>");
  process.exit(1);
}
config({ path: envFile, override: true });

const { getServiceClient } = await import("../../lib/supabase/server");
const { evaluateCompletenessV2 } = await import("../../lib/automation/completeness");
const { evaluateAutoSaveGate } = await import("../../lib/automation/autoSaveGate");
const { classifyFacts } = await import("../../lib/defence/factClassifier");
const { resolveReasonCodeModuleForContext } = await import("../../lib/defence/reasonCodes/registry");
const { PRODUCT_EVIDENCE_QUERY } = await import("../../lib/shopify/queries/productEvidence");

const sb = getServiceClient();
const API = process.env.SHOPIFY_API_VERSION || "2026-01";

function decrypt(b: string): string {
  const [v, i, t, c] = b.split(":");
  const ver = v.replace(/^v/, "");
  const k = process.env[`TOKEN_ENCRYPTION_KEY_V${ver}`] || process.env.TOKEN_ENCRYPTION_KEY!;
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(k, "hex"), Buffer.from(i, "hex"));
  d.setAuthTag(Buffer.from(t, "hex"));
  return d.update(Buffer.from(c, "hex"), undefined, "utf8") + d.final("utf8");
}

const tokens = new Map<string, { domain: string; token: string }>();
async function shopAuth(shopId: string) {
  if (tokens.has(shopId)) return tokens.get(shopId)!;
  const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", shopId).single();
  const { data: s } = await sb
    .from("shop_sessions")
    .select("access_token_encrypted")
    .eq("shop_id", shopId)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const v = { domain: shop!.shop_domain as string, token: decrypt(s!.access_token_encrypted as string) };
  tokens.set(shopId, v);
  return v;
}

async function liveListing(shopId: string, orderGid: string) {
  const { domain, token } = await shopAuth(shopId);
  const r = await fetch(`https://${domain}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "content-type": "application/json" },
    body: JSON.stringify({ query: PRODUCT_EVIDENCE_QUERY, variables: { id: orderGid, after: null } }),
  });
  const j = (await r.json()) as { errors?: unknown; data?: { order?: { lineItems?: { nodes: Array<{ product: { title: string | null; description: string | null } | null; variant: unknown }> } } } };
  if (j.errors) return { outcome: /ACCESS_DENIED/i.test(JSON.stringify(j.errors)) ? "inaccessible" : "failed", title: null as string | null };
  const nodes = j.data?.order?.lineItems?.nodes ?? [];
  const present = nodes.find((n) => n.product && (n.product.title || n.product.description));
  if (present) return { outcome: "present", title: present.product!.title };
  if (nodes.some((n) => !n.product && !n.variant)) return { outcome: "custom_item", title: null };
  if (nodes.some((n) => !n.product)) return { outcome: "deleted", title: null };
  return { outcome: nodes.length ? "absent" : "no_line_items", title: null };
}

const { data: disputes } = await sb
  .from("disputes")
  .select("id, shop_id, order_gid, order_name, reason, due_at, dispute_gid")
  .eq("reason", "PRODUCT_UNACCEPTABLE")
  .is("final_outcome", null)
  .is("closed_at", null)
  .not("order_gid", "is", null)
  .order("due_at");

const module = resolveReasonCodeModuleForContext(null, "PRODUCT_UNACCEPTABLE");
type Row = Record<string, string | number | boolean | null>;
const rows: Row[] = [];

for (const d of disputes ?? []) {
  if (String(d.dispute_gid).includes("seed") || String(d.order_gid).includes("SEED")) continue;
  const { data: pack } = await sb
    .from("evidence_packs")
    .select("id, pack_json, completeness_score, submission_readiness, pack_template_id, waived_items")
    .eq("dispute_id", d.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pack) continue;
  const { data: dpkg } = await sb
    .from("defence_packages")
    .select("version, status, package_mode")
    .eq("dispute_id", d.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: settings } = await sb
    .from("shop_settings")
    .select("auto_save_enabled, auto_save_min_score, enforce_no_blockers")
    .eq("shop_id", d.shop_id)
    .maybeSingle();

  let templateItems: Array<{ key: string; label: string; required: boolean; collector_key: string | null }> | null = null;
  if (pack.pack_template_id) {
    const { data: secs } = await sb
      .from("pack_template_sections")
      .select("sort, pack_template_items(key, label_default, required, collector_key, sort)")
      .eq("template_id", pack.pack_template_id)
      .order("sort");
    templateItems = (secs ?? []).flatMap((s) =>
      [...((s as { pack_template_items?: Array<{ key: string; label_default: string; required: boolean; collector_key: string | null; sort: number }> }).pack_template_items ?? [])]
        .sort((a, b) => a.sort - b.sort)
        .map((it) => ({ key: it.key, label: it.label_default, required: it.required, collector_key: it.collector_key })),
    );
  }

  const sections = ((pack.pack_json as { sections?: Array<{ type: string; label?: string; source: string; data?: Record<string, unknown>; fieldsProvided?: string[] }> })?.sections ?? []);
  const present = new Set<string>(sections.flatMap((s) => s.fieldsProvided ?? []));
  const live = await liveListing(d.shop_id as string, d.order_gid as string);
  const withListing = live.outcome === "present";

  const completeness = (flag: boolean) => {
    process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = flag ? "true" : "false";
    const fields = new Set(present);
    if (flag && withListing) fields.add("product_description");
    return evaluateCompletenessV2(d.reason, fields, (pack.waived_items as never) ?? null, templateItems as never);
  };
  const off = completeness(false);
  const on = completeness(true);
  process.env.PRODUCT_LISTING_EVIDENCE_ENABLED = "false";

  const strength = ((pack.pack_json as { case_strength?: { overall?: string } })?.case_strength?.overall ?? "moderate") as never;
  const classify = (extra: boolean) =>
    classifyFacts({
      packageId: "replay",
      sections: [
        ...sections.map((s) => ({ type: s.type, label: s.label ?? "", source: s.source, data: s.data ?? {}, fieldsProvided: s.fieldsProvided ?? [] })),
        ...(extra
          ? [{ type: "other", label: "", source: "shopify_product", data: { listings: [{ snapshotId: "x", lineItemGid: "x", contentHash: "x", title: live.title, fetchedAt: new Date().toISOString() }], outcomes: [] }, fieldsProvided: ["product_description"] }]
          : []),
      ],
      evidenceItems: [],
      checklist: [],
      coverage: { state: "not_covered" },
      fatalLoss: { triggered: false, reason: null },
      caseStrength: strength,
      manualRows: [],
      reasonCodeModule: module,
    });
  const modeOff = classify(false).packageMode;
  const modeOn = classify(withListing).packageMode;

  const gate = (score: number, readiness: string) =>
    settings
      ? evaluateAutoSaveGate({
          autoSaveEnabled: settings.auto_save_enabled as boolean,
          autoSaveMinScore: settings.auto_save_min_score as number,
          enforceNoBlockers: settings.enforce_no_blockers as boolean,
          completenessScore: score,
          blockers: [],
          submissionReadiness: readiness as never,
        }).action
      : "no_settings";

  rows.push({
    order: d.order_name as string,
    due: String(d.due_at).slice(0, 10),
    listing: live.outcome,
    templated: !!pack.pack_template_id,
    storedScore: pack.completeness_score as number,
    scoreOff: off.completenessScore,
    scoreOn: on.completenessScore,
    readinessOff: off.submissionReadiness,
    readinessOn: on.submissionReadiness,
    gateOff: gate(off.completenessScore, off.submissionReadiness),
    gateOn: gate(on.completenessScore, on.submissionReadiness),
    modeOff,
    modeOn,
    letter: dpkg ? `v${dpkg.version} ${dpkg.status}` : "none",
    goesStale: withListing && !!dpkg,
  });
  console.log(JSON.stringify(rows[rows.length - 1]));
}

const count = (f: (r: Row) => boolean) => rows.filter(f).length;
const lines = [
  "# Not-as-described — flag-ON replay (prod, read-only)",
  "",
  `Run ${new Date().toISOString()} against prod. Population: open PRODUCT_UNACCEPTABLE disputes with a pack (${rows.length}). Listing outcome from a live read-only Shopify query; score/mode computed from the same inputs with the flag OFF vs ON.`,
  "",
  "## Summary",
  "",
  `- Listing found: **${count((r) => r.listing === "present")}** of ${rows.length}; other outcomes: ${[...new Set(rows.filter((r) => r.listing !== "present").map((r) => r.listing))].map((o) => `${o} ${count((r) => r.listing === o)}`).join(", ") || "none"}.`,
  `- Completeness score changes: ${count((r) => r.scoreOff !== r.scoreOn)} (up ${count((r) => (r.scoreOn as number) > (r.scoreOff as number))}, down ${count((r) => (r.scoreOn as number) < (r.scoreOff as number))}).`,
  `- Readiness changes: ${count((r) => r.readinessOff !== r.readinessOn)}.`,
  `- Auto-save gate flips: ${count((r) => r.gateOff !== r.gateOn)} (block→auto_save ${count((r) => r.gateOff === "block" && r.gateOn === "auto_save")}, auto_save→block ${count((r) => r.gateOff === "auto_save" && r.gateOn === "block")}).`,
  `- Letter mode narrow→full: ${count((r) => r.modeOff === "narrow" && r.modeOn === "full")}; full→narrow: ${count((r) => r.modeOff === "full" && r.modeOn === "narrow")}.`,
  `- Existing letters that go stale (would rebuild): ${count((r) => r.goesStale === true)}.`,
  "",
  "## Per dispute",
  "",
  "| Order | Due | Listing | Templated | Stored score | Score off → on | Readiness off → on | Gate off → on | Mode off → on | Letter | Goes stale |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.order} | ${r.due} | ${r.listing} | ${r.templated ? "yes" : "no"} | ${r.storedScore} | ${r.scoreOff} → ${r.scoreOn} | ${r.readinessOff} → ${r.readinessOn} | ${r.gateOff} → ${r.gateOn} | ${r.modeOff} → ${r.modeOn} | ${r.letter} | ${r.goesStale ? "yes" : "no"} |`),
  "",
];
fs.writeFileSync(out, lines.join("\n"));
console.log(`wrote ${out}`);
process.exit(0);
