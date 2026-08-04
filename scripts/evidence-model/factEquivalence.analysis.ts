/**
 * P4 gate: does the model select the SAME bank-facing facts as `classifyFacts`?
 *
 * RESULT, prod 2026-08-04: 0 of 76 identical. P4 DOES NOT SHIP. The gate did
 * its job — see the finding recorded at the bottom of this file.
 *
 * READ-ONLY. No writes, no package regeneration, no submission side effects.
 *
 * P4 proposes that `classifyFacts` become a projection of the canonical model.
 * That changes what the ISSUER receives, so it does not ship on an argument —
 * it ships only if, on every live pack, the model selects exactly the same
 * facts with exactly the same bank-eligibility.
 *
 * WHAT IS COMPARED. Not the whole `EvidenceFact`: `value` comes from
 * `extractValue`, which stays in the classifier either way (the model owns
 * WHICH facts and their eligibility; extractValue owns the value SHAPE the
 * LLM and the PDF read). So the comparison is over the decisions the model
 * would take over:
 *
 *   - the set of field keys that produce a fact at all
 *   - `bankEligible` per field
 *   - `includeInBankNarrative` per field
 *
 * A difference in ANY of those is a difference in what the bank sees.
 */

import { describe, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  classifyFacts,
  type PackSectionLike,
} from "@/lib/defence/factClassifier";
import { resolveReasonCodeModule } from "@/lib/defence/reasonCodes/registry";
import { deriveCaseEvidenceModel } from "@/lib/evidence/model/derive";
import { selectForBank } from "@/lib/evidence/model/projections";

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
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + page - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

interface PackRow {
  id: string;
  dispute_id: string;
  pack_json: Record<string, unknown> | null;
}
interface DisputeRow {
  id: string;
  reason: string | null;
  order_name: string | null;
}

describe("P4 gate — model vs classifyFacts on live packs", () => {
  it("selects the same bank-facing fields", async () => {
    const disputes = await rest<DisputeRow>(
      "disputes?select=id,reason,order_name&final_outcome=is.null",
    );
    const byId = new Map(disputes.map((d) => [d.id, d]));
    const packs = (
      await rest<PackRow>(
        "evidence_packs?select=id,dispute_id,pack_json&status=eq.ready",
      )
    ).filter((p) => byId.has(p.dispute_id));

    let identical = 0;
    const diffs: string[] = [];

    for (const pack of packs) {
      const dispute = byId.get(pack.dispute_id)!;
      const rawSections =
        (pack.pack_json?.sections as {
          type?: string;
          label?: string;
          source?: string;
          data?: Record<string, unknown>;
          fieldsProvided?: string[];
        }[]) ?? [];

      const sections: PackSectionLike[] = rawSections.map((s) => ({
        type: s.type ?? "other",
        label: s.label ?? "",
        source: s.source ?? "",
        data: s.data ?? {},
        fieldsProvided: s.fieldsProvided ?? [],
      }));

      // TODAY: the live classifier, with the same inputs buildDefencePackageJob
      // gives it (caseStrength is hard-coded "moderate" there — reproduced so
      // the comparison is against production, not against an idealised call).
      const today = classifyFacts({
        packageId: pack.id,
        sections,
        evidenceItems: [],
        checklist: [],
        coverage: { state: "not_covered" },
        fatalLoss: { triggered: false, reason: null },
        caseStrength: "moderate",
        manualRows: [],
        reasonCodeModule: resolveReasonCodeModule((dispute.reason ?? "GENERAL") as never),
      });

      const todayBank = new Set(
        today.approved
          .filter((f) => f.bankEligible && f.includeInBankNarrative)
          .map((f) => String((f.value as { fieldKey?: string }).fieldKey)),
      );

      // PROPOSED: the model's bank projection.
      const { model } = deriveCaseEvidenceModel({
        disputeId: dispute.id,
        reason: dispute.reason,
        packId: pack.id,
        sections: rawSections,
      });
      const modelBank = new Set<string>(selectForBank(model).map((r) => String(r.fieldKey)));

      const onlyToday = [...todayBank].filter((f) => !modelBank.has(f)).sort();
      const onlyModel = [...modelBank].filter((f) => !todayBank.has(f)).sort();

      if (onlyToday.length === 0 && onlyModel.length === 0) {
        identical += 1;
      } else {
        diffs.push(
          `${(dispute.order_name ?? dispute.id).padEnd(11)} ${(dispute.reason ?? "").padEnd(22)} ` +
            `classifier-only=[${onlyToday}] model-only=[${onlyModel}]`,
        );
      }
    }

    console.log(`\n=== P4 gate — ${packs.length} live packs ===\n`);
    console.log(`identical bank-facing field sets : ${identical}`);
    console.log(`differing                        : ${diffs.length}\n`);
    for (const d of diffs.slice(0, 40)) console.log(`  ${d}`);
    if (diffs.length > 40) console.log(`  … and ${diffs.length - 40} more`);

    const byPattern = new Map<string, number>();
    for (const d of diffs) {
      const m = d.match(/classifier-only=\[(.*?)\] model-only=\[(.*?)\]/);
      if (m) {
        const k = `classifier-only=[${m[1]}] model-only=[${m[2]}]`;
        byPattern.set(k, (byPattern.get(k) ?? 0) + 1);
      }
    }
    console.log(`\n-- distinct difference patterns --`);
    for (const [k, n] of [...byPattern].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}x  ${k}`);
    }
    console.log(
      `\n>>> P4 ships only at 0 differences. Anything else is a change to what ` +
        `the issuer receives and needs its own decision.\n`,
    );
  });
});

/*
 * ── RESULT (prod, 2026-08-04) ─────────────────────────────────────────────
 *
 *   identical : 0 of 76
 *   differing : 76 of 76
 *
 * The differences are systematic, not noise, and they are TWO distinct causes:
 *
 * 1. model-only = [activity_log, cancellation_policy, customer_account_info,
 *    order_confirmation, refund_policy, shipping_policy, ip_location_check,
 *    customer_communication]
 *
 *    `classifyFacts` filters facts through
 *    `reasonCodeModule.allowedFactCategories`; `selectForBank` does not.
 *
 *    This is NOT a porting bug — it is the same gate that caused the incident
 *    this whole migration exists for. On #352552 that allow-list suppressed
 *    `payment_authentication`, which is why `lib/defence/alwaysAdmissible.ts`
 *    was written to punch through it for facts that cannot read against us.
 *    So the honest question P4 raises is not "how do I make the projection
 *    match the classifier" but "should the reason-module allow-list survive at
 *    all, now that a model knows what each record is worth?" That decides what
 *    the ISSUER receives on every dispute, and it is a product call.
 *
 * 2. classifier-only = [shipping_tracking]
 *
 *    The projection collapses `shipping_tracking` into `delivery_proof` via
 *    the declared `aggregation.collapsesWith`; `classifyFacts` emits both and
 *    collapses later, in `evidenceBasisRows.collapseDeliveryPair`. Same end
 *    state in the PDF, different fact sets — so the LLM sees one tracking fact
 *    under one path and two under the other.
 *
 * NEITHER is safe to resolve inside a refactor. P4 stays open with this
 * measurement attached.
 */
