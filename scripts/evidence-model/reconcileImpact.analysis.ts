/**
 * Impact of the ADDITIVE reconcile (2026-08-04) on live packs. READ-ONLY.
 *
 * `reconcileChecklistWithCollectedFields` now appends a row for any collected
 * canonical field the reason template omitted. Both the merchant surfaces and
 * `calculateCaseStrength` read that checklist, so this measures the two things
 * that can move: completeness (→ the auto-save gate) and strength (→ the
 * auto-submit guards).
 *
 * The old rule is reproduced inline rather than imported, because the point is
 * to compare against behaviour that no longer exists in the codebase.
 */

import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  deriveCompletenessMetrics,
  type OrderContext,
} from "@/lib/automation/completeness";
import {
  reconcileChecklistWithCollectedFields,
  normalizeChecklistV2Shape,
} from "@/lib/packs/checklistReconcile";
import { calculateCaseStrength, type CaseStrengthGates } from "@/lib/argument/caseStrength";
import type { ChecklistItemV2 } from "@/lib/types/evidenceItem";

const ENV_FILE = process.env.ANALYSIS_ENV_FILE ?? ".env.production.local";

function loadEnv(file: string): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    for (const line of readFileSync(join(process.cwd(), file), "utf-8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      let v = t.slice(i + 1).trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      const k = t.slice(0, i).trim();
      if (v === "" && vars[k]) continue;
      vars[k] = v;
    }
  } catch {
    /* ignore */
  }
  return vars;
}
const env = loadEnv(ENV_FILE);
const get = (k: string) => (env[k] && env[k] !== "" ? env[k] : process.env[k]);

async function rest<T>(path: string): Promise<T[]> {
  const url = (get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error(`Need prod credentials in ${ENV_FILE}`);
  const page = 500;
  const out: T[] = [];
  for (let offset = 0; ; offset += page) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${offset}-${offset + page - 1}` },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

/** The pre-2026-08-04 rule: flip `missing` → `available`, never append. */
function legacyReconcile(raw: unknown, collected: Set<string>): ChecklistItemV2[] {
  const normalized = normalizeChecklistV2Shape(raw) ?? [];
  return normalized.map((c) =>
    c.status === "missing" && collected.has(c.field)
      ? { ...c, status: "available" as const, unavailableReason: undefined }
      : c,
  );
}

interface PackRow {
  id: string; shop_id: string; dispute_id: string;
  checklist_v2: unknown; pack_json: Record<string, unknown> | null;
}
interface DisputeRow { id: string; reason: string | null; order_name: string | null }
interface SettingsRow { shop_id: string; auto_save_min_score: number | null }
interface ShopRow { id: string; shop_domain: string }

void ({} as OrderContext);

describe("additive reconcile — impact on live packs", () => {
  it("reports completeness and strength movement per shop", async () => {
    const [disputes, packs, settings, shops] = await Promise.all([
      rest<DisputeRow>("disputes?select=id,reason,order_name&final_outcome=is.null"),
      rest<PackRow>("evidence_packs?select=id,shop_id,dispute_id,checklist_v2,pack_json&status=eq.ready"),
      rest<SettingsRow>("shop_settings?select=shop_id,auto_save_min_score"),
      rest<ShopRow>("shops?select=id,shop_domain"),
    ]);
    const byDispute = new Map(disputes.map((d) => [d.id, d]));
    const thrByShop = new Map(settings.map((s) => [s.shop_id, s.auto_save_min_score ?? 0]));
    const domain = new Map(shops.map((s) => [s.id, s.shop_domain]));
    const open = packs.filter((p) => byDispute.has(p.dispute_id));

    const perShop = new Map<string, { n: number; dScore: number[]; cross: string[]; sFlip: string[] }>();

    for (const pack of open) {
      const d = byDispute.get(pack.dispute_id)!;
      const shop = domain.get(pack.shop_id) ?? pack.shop_id;
      const thr = thrByShop.get(pack.shop_id) ?? 0;
      const sections =
        (pack.pack_json?.sections as { fieldsProvided?: string[]; data?: Record<string, unknown> }[]) ?? [];
      const collected = new Set(sections.flatMap((s) => s.fieldsProvided ?? []));
      const payloadSource = {
        kind: "list" as const,
        items: sections.map((s) => ({ payload: { ...(s.data ?? {}), fieldsProvided: s.fieldsProvided } })),
      };
      const j = (pack.pack_json ?? {}) as Record<string, never>;
      const gates: CaseStrengthGates = {
        coverage: (j.coverage as never) ?? null,
        fatalLoss: (j.fatal_loss as never) ?? null,
        riskWeakness: (j.risk_weakness as never) ?? null,
        nameMismatch: (j.name_mismatch as never) ?? null,
        creditAlreadyIssued: (j.credit_already_issued as never) ?? null,
      };

      const before = legacyReconcile(pack.checklist_v2, collected);
      const after = reconcileChecklistWithCollectedFields(pack.checklist_v2 as never, collected);

      const cBefore = deriveCompletenessMetrics(before).completenessScore;
      const cAfter = deriveCompletenessMetrics(after).completenessScore;
      const sBefore = calculateCaseStrength(before, d.reason, payloadSource, gates).overall;
      const sAfter = calculateCaseStrength(after, d.reason, payloadSource, gates).overall;

      const acc = perShop.get(shop) ?? { n: 0, dScore: [], cross: [], sFlip: [] };
      acc.n += 1;
      acc.dScore.push(cAfter - cBefore);
      if ((cBefore < thr) !== (cAfter < thr)) {
        acc.cross.push(`${d.order_name} ${cBefore}→${cAfter} (thr ${thr})`);
      }
      if (sBefore !== sAfter) acc.sFlip.push(`${d.order_name} ${sBefore}→${sAfter}`);
      perShop.set(shop, acc);
    }

    console.log(`\n=== Additive reconcile impact — ${open.length} open ready packs ===\n`);
    for (const [shop, a] of perShop) {
      const avg = (a.dScore.reduce((x, y) => x + y, 0) / a.n).toFixed(1);
      const worst = Math.min(...a.dScore);
      const best = Math.max(...a.dScore);
      console.log(
        `${shop.padEnd(26)} packs=${String(a.n).padStart(3)}  avg completeness Δ ${avg.padStart(6)}  ` +
          `range ${worst}..${best}  auto-save flips=${a.cross.length}  strength flips=${a.sFlip.length}`,
      );
      for (const c of a.cross.slice(0, 10)) console.log(`     GATE  ${c}`);
      for (const s of a.sFlip.slice(0, 10)) console.log(`     STR   ${s}`);
    }
    console.log("");
  });
});
