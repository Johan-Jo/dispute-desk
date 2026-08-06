/**
 * P2c evidence: per-shop threshold-crossing analysis.
 *
 * READ-ONLY. No writes, no job enqueues, no disposition stamps. Report only.
 *
 * WHY THIS GATES THE PHASE. `evaluateAutoSaveGate` blocks when
 * `completeness_score < shop_settings.auto_save_min_score`. Completeness
 * divides present weight by total weight, so ANY change to the row set moves
 * the score for every dispute at once. A pack sitting just under its shop's
 * threshold newly passes — and passing means DisputeDesk files the evidence
 * on the merchant's behalf. That is the one number that must be known before
 * this phase ships, and it has to be per shop, because the threshold is a
 * per-shop setting.
 *
 * Reports three values per pack, per the plan's Verification §2:
 *   persisted — `evidence_packs.completeness_score`, written at build time
 *   runtime   — `deriveCompletenessMetrics` re-run now on the persisted checklist
 *   model     — the same engine fed from `CaseEvidenceModel`, both policies
 *
 * Run: npm run analysis:evidence -- scripts/evidence-model/completenessThreshold.analysis.ts
 */

import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  deriveCompletenessMetrics,
  evaluateCompletenessV2,
  type OrderContext,
} from "@/lib/automation/completeness";
import { reconcileChecklistWithCollectedFields } from "@/lib/packs/checklistReconcile";
import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";
import { completenessChecklistFromModel } from "@/lib/evidence/model/assessment";

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
    /* fall through */
  }
  return vars;
}

const env = loadEnv(ENV_FILE);
const get = (k: string) => (env[k] && env[k] !== "" ? env[k] : process.env[k]);

async function rest<T>(path: string): Promise<T[]> {
  const url = (get("SUPABASE_URL") ?? get("NEXT_PUBLIC_SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error(`Need prod credentials in ${ENV_FILE}`);
  const page = 500;
  const out: T[] = [];
  for (let offset = 0; ; offset += page) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + page - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

interface PackRow {
  id: string;
  shop_id: string;
  dispute_id: string;
  completeness_score: number | null;
  checklist_v2: unknown;
  pack_json: Record<string, unknown> | null;
}
interface DisputeRow { id: string; reason: string | null; order_name: string | null }
interface SettingsRow {
  shop_id: string;
  auto_save_enabled: boolean | null;
  auto_save_min_score: number | null;
}
interface ShopRow { id: string; shop_domain: string }

describe("P2c — completeness threshold crossings (prod, read-only)", () => {
  it("reports per-shop crossings of auto_save_min_score", async () => {
    const [disputes, packs, settings, shops] = await Promise.all([
      rest<DisputeRow>("disputes?select=id,reason,order_name&final_outcome=is.null"),
      rest<PackRow>(
        "evidence_packs?select=id,shop_id,dispute_id,completeness_score,checklist_v2,pack_json&status=eq.ready",
      ),
      rest<SettingsRow>("shop_settings?select=shop_id,auto_save_enabled,auto_save_min_score"),
      rest<ShopRow>("shops?select=id,shop_domain"),
    ]);

    const byDispute = new Map(disputes.map((d) => [d.id, d]));
    const settingsByShop = new Map(settings.map((s) => [s.shop_id, s]));
    const domainByShop = new Map(shops.map((s) => [s.id, s.shop_domain]));
    const open = packs.filter((p) => byDispute.has(p.dispute_id));

    const rows: {
      shop: string;
      order: string;
      threshold: number;
      autoSave: boolean;
      persisted: number;
      runtime: number;
      /** The model's score under P-1 (strict `not_applicable` handling). */
      strict: number;
    }[] = [];

    for (const pack of open) {
      const dispute = byDispute.get(pack.dispute_id)!;
      const setting = settingsByShop.get(pack.shop_id);
      const sections =
        (pack.pack_json?.sections as {
          source?: string;
          fieldsProvided?: string[];
          data?: Record<string, unknown>;
        }[]) ?? [];
      const collected = new Set(sections.flatMap((s) => s.fieldsProvided ?? []));

      // Order context reconstructed from the PERSISTED checklist: a row the
      // build marked `unavailable` is exactly a field this order cannot
      // produce. Reading it back is faithful to what production decided and
      // avoids re-fetching orders from Shopify for a read-only report.
      const persistedChecklist =
        (pack.checklist_v2 as { field: string; status: string }[]) ?? [];
      const persistedFields = new Set(persistedChecklist.map((c) => c?.field));
      const unavailable = new Set(
        persistedChecklist.filter((c) => c?.status === "unavailable").map((c) => c.field),
      );
      // A field the template requires CONDITIONALLY and that is absent from
      // the persisted checklist entirely was not collectable at build time.
      const notCollectable = (f: string) => unavailable.has(f) || !persistedFields.has(f);
      const orderContext: OrderContext = {
        isFulfilled: !notCollectable("delivery_proof"),
        hasCardPayment: !notCollectable("avs_cvv_match"),
        avsCvvAvailable: !notCollectable("avs_cvv_match"),
        hasRefund: !notCollectable("refund_record"),
      };

      // BASELINE = the CURRENT template, re-evaluated now. Using the persisted
      // checklist instead compares stale-template vs current-template, not old
      // engine vs new: `refund_record` joined the FRAUDULENT template on
      // 2026-08-01 and `fraud_risk_screening` later still, so packs built
      // before those dates carry row sets the code no longer produces. That
      // mismatch alone read ~28 points and is template drift, not a
      // regression this phase introduces.
      const runtime = evaluateCompletenessV2(
        dispute.reason,
        collected,
        [],
        null,
        orderContext,
      ).completenessScore;
      void reconcileChecklistWithCollectedFields;
      const { model } = deriveCaseEvidenceModel({
        disputeId: dispute.id,
        reason: dispute.reason,
        packId: pack.id,
        sections,
        orderContext,
      });
      // P-1 (approved 2026-08-06) is strict: a `not_applicable` record enters
      // neither the numerator nor the denominator. The permissive arm this
      // script used to compute alongside it measured a behaviour the product
      // can no longer produce, so calibration now reads one column.
      const strict = deriveCompletenessMetrics(
        completenessChecklistFromModel(model),
      ).completenessScore;

      rows.push({
        shop: domainByShop.get(pack.shop_id) ?? pack.shop_id,
        order: dispute.order_name ?? dispute.id,
        threshold: setting?.auto_save_min_score ?? 0,
        autoSave: setting?.auto_save_enabled === true,
        persisted: pack.completeness_score ?? 0,
        runtime,
        strict,
      });
    }

    console.log(`\n=== P2c completeness — ${rows.length} open ready packs ===\n`);

    const byShop = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byShop.get(r.shop) ?? [];
      list.push(r);
      byShop.set(r.shop, list);
    }

    console.log("shop                       packs  thr  autoSave  modelΔ  CROSSINGS");
    let totalStrictCross = 0;
    for (const [shop, list] of [...byShop].sort((a, b) => b[1].length - a[1].length)) {
      const thr = list[0].threshold;
      const autoSave = list[0].autoSave;
      const avg = (f: (r: (typeof rows)[number]) => number) =>
        (list.reduce((a, r) => a + f(r), 0) / list.length).toFixed(1);
      // Crossings in BOTH directions. An earlier version counted only
      // upward ones ("newly auto-files"), which measured the wrong risk: the
      // model scores LOWER than the template baseline, so the real exposure is
      // packs falling BELOW the threshold and no longer auto-filing — evidence
      // that gets held instead of sent. Counting one direction would have
      // reported a reassuring 0 while the actual effect was the opposite.
      const strictCross = list.filter(
        (r) =>
          (r.runtime < r.threshold && r.strict >= r.threshold) ||
          (r.runtime >= r.threshold && r.strict < r.threshold),
      );
      totalStrictCross += strictCross.length;
      console.log(
        `${shop.padEnd(26)} ${String(list.length).padStart(5)}  ${String(thr).padStart(3)}  ` +
          `${String(autoSave).padEnd(8)}  ${avg((r) => r.strict - r.runtime).padStart(6)}  ` +
          `${strictCross.length}`,
      );
      for (const c of strictCross.slice(0, 6)) {
        console.log(
          `      ${c.order.padEnd(10)} runtime=${c.runtime} model=${c.strict} thr=${c.threshold}`,
        );
      }
    }

    // ── Recommended threshold under the "usable evidence" semantics ──
    //
    // DECISION (user, 2026-08-04): completeness measures usable evidence, not
    // mere collection. The model therefore scores lower than the template
    // baseline, and each shop's auto_save_min_score must be lowered BEFORE
    // the semantics ship — otherwise 64 of 76 packs silently stop auto-filing.
    //
    // The recommendation preserves TODAY'S dispositions exactly: the highest
    // threshold at which every pack that auto-saves now still auto-saves, and
    // no pack that is blocked now newly passes. Where those two constraints
    // cannot both hold, the conflict is printed rather than resolved silently.
    console.log(
      "\n=== RECOMMENDED auto_save_min_score (preserves today's dispositions) ===\n",
    );
    for (const [shop, list] of [...byShop].sort((a, b) => b[1].length - a[1].length)) {
      const thr = list[0].threshold;
      const passesToday = list.filter((r) => r.runtime >= thr);
      const blockedToday = list.filter((r) => r.runtime < thr);
      // Must be <= the weakest pack that passes today...
      const floor = passesToday.length
        ? Math.min(...passesToday.map((r) => r.strict))
        : null;
      // ...and > the strongest pack that is blocked today.
      const ceiling = blockedToday.length
        ? Math.max(...blockedToday.map((r) => r.strict))
        : null;
      const ok = floor !== null && (ceiling === null || floor > ceiling);
      console.log(
        `${shop.padEnd(26)} current=${thr}  recommended=${floor ?? "n/a"}` +
          `  (must stay above blocked-max ${ceiling ?? "n/a"})  ${ok ? "OK" : "CONFLICT"}`,
      );
      if (!ok && floor !== null && ceiling !== null) {
        console.log(
          `   No single threshold preserves both: the weakest pack that passes today scores ` +
            `${floor}, while a pack blocked today scores ${ceiling}. The new semantics do not ` +
            `merely rescale — they REORDER. Some disposition must change; the trade at each ` +
            `candidate threshold:`,
        );
        // Enumerate every candidate so the choice is made on counts, not vibes.
        const candidates = [...new Set(list.map((r) => r.strict))].sort((a, b) => a - b);
        for (const t of candidates) {
          const newlyFiles = blockedToday.filter((r) => r.strict >= t).length;
          const newlyBlocked = passesToday.filter((r) => r.strict < t).length;
          if (newlyFiles === 0 && newlyBlocked === 0) continue;
          console.log(
            `     threshold ${String(t).padStart(3)} → newly AUTO-FILES ${newlyFiles}, ` +
              `newly BLOCKS ${newlyBlocked}`,
          );
        }
      }
    }

    const stale = rows.filter((r) => r.persisted !== r.runtime);
    console.log(`\n-- persisted vs runtime (stale snapshots) -- ${stale.length} of ${rows.length}`);
    for (const s of stale.slice(0, 10)) {
      console.log(`   ${s.order.padEnd(10)} persisted=${s.persisted} runtime=${s.runtime}`);
    }

    console.log(
      `\n>>> THRESHOLD CROSSINGS under the model (P-1 strict): ${totalStrictCross}\n`,
    );
  });
});
