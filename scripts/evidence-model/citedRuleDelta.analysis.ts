/**
 * Offline measurement of the "one cited rule" change (lib/defence/citedFacts.ts).
 *
 * Reads a READ-ONLY sample of stored `defence_packages.facts_json`
 * (scripts/sql/cited-rule-sample.sql) and runs BOTH Evidence Basis rules over
 * every package: the legacy table (rule 1) and the cited table (rule 2). No
 * network, no database, nothing written.
 *
 *   npx tsx scripts/evidence-model/citedRuleDelta.analysis.ts <sample.json>
 *
 * It answers the ship question: what moves, and does anything that must stay
 * internal become visible? The second is asserted, not eyeballed: every row the
 * new table prints must come from a fact the legacy rule would also have let an
 * issuer see, and none may carry a submission risk or lack bank eligibility.
 */

import fs from "node:fs";
import type { DefenceNarrativeOutput, EvidenceFact } from "../../lib/defence/types";
import { evidenceBasisFor } from "../../lib/defence/render/documentModel";
import {
  argumentFactIdsOfNarrative,
  EVIDENCE_BASIS_RULE_CITED,
  EVIDENCE_BASIS_RULE_LEGACY,
} from "../../lib/defence/citedFacts";
import { isBankIncludedFact } from "../../lib/defence/bankInclusion";
import { buildEvidenceBasisRows } from "../../lib/defence/pdf/evidenceBasisRows";
import { evidenceFieldOfFact } from "../../lib/disputes/letterCitations";

interface Row {
  id: string;
  shop_id: string;
  reason_code_module: string | null;
  package_mode: string | null;
  status: string;
  generated_at: string;
  facts_json: EvidenceFact[];
  narrative_json: DefenceNarrativeOutput;
}

const raw = fs.readFileSync(process.argv[2], "utf8");
const rows = (JSON.parse(raw.slice(raw.indexOf("{"))) as { rows: Row[] }).rows;

const family = (m: string | null): string => {
  const k = (m ?? "unknown").toLowerCase();
  if (/fraud|unrecogn|10_4|4837|unauth/.test(k)) return "fraud";
  if (/not_?received|inr|product_not|13_1|4855|delivery/.test(k)) return "not_received";
  if (/credit|13_6|4853/.test(k)) return "credit_not_processed";
  if (/described|unacceptable|13_3|4853_nad|not_as/.test(k)) return "not_as_described";
  if (/subscr|cancel|13_2|recurring/.test(k)) return "subscription";
  if (/dupl|13_6/.test(k)) return "duplicate";
  return m ?? "unknown";
};

/** The evidence fields the dispute page has an item for. */
const KNOWN_ITEM_FIELDS = new Set([
  "avs_cvv_match", "tds_authentication", "fraud_risk_screening", "ip_location_check", "shipping_tracking",
  "no_return_initiated", "order_confirmation", "activity_log", "shipping_policy", "refund_policy",
  "cancellation_policy", "customer_communication",
]);

const count = <K extends string>(m: Map<K, number>, k: K, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const shops = new Set<string>();
const byFamily = new Map<string, number>();
const removed = new Map<string, number>();
const added = new Map<string, number>();
const modules = new Map<string, number>();
let changed = 0;
let identical = 0;
let legacyRows = 0;
let newRows = 0;
let multiParcel = 0;
let tableAppears = 0;
let tableDisappears = 0;
let adverseLeak = 0;
let previouslyCitedGone = 0;
let contextArguedLegacy = 0;
let contextArguedKept = 0;
let contextUnargued = 0;
let contextUnarguedStillListed = 0;
let arguedButUnlisted = 0;
const unlistedWhy = new Map<string, number>();
const unrepresented = new Map<string, number>();
const examples: string[] = [];

for (const r of rows) {
  const facts = r.facts_json;
  shops.add(r.shop_id);
  count(byFamily, family(r.reason_code_module));
  count(modules, r.reason_code_module ?? "null");
  const L = evidenceBasisFor(facts, EVIDENCE_BASIS_RULE_LEGACY);
  const argued = argumentFactIdsOfNarrative(r.narrative_json, r.reason_code_module);
  const N = evidenceBasisFor(facts, EVIDENCE_BASIS_RULE_CITED, argued);
  const printsLegacy = L.tableAllowed && L.rows.length > 0;
  const printsNew = N.tableAllowed && N.rows.length > 0;
  if (N.multiParcel) multiParcel += 1;
  const lKeys = new Set((printsLegacy ? L.rows : []).map((x) => `${x.category}|${x.label}|${x.value}`));
  const nKeys = new Set((printsNew ? N.rows : []).map((x) => `${x.category}|${x.label}|${x.value}`));
  legacyRows += lKeys.size;
  newRows += nKeys.size;
  if (!printsLegacy && printsNew) tableAppears += 1;
  if (printsLegacy && !printsNew) tableDisappears += 1;

  let diff = false;
  for (const k of lKeys) {
    if (!nKeys.has(k)) {
      diff = true;
      count(removed, k.split("|")[1]);
    }
  }
  for (const k of nKeys) {
    if (!lKeys.has(k)) {
      diff = true;
      count(added, k.split("|")[1]);
    }
  }
  if (diff) {
    changed += 1;
    if (examples.length < 3) {
      examples.push(`${r.id} ${r.reason_code_module}\n   legacy: ${[...lKeys].map((k) => k.split("|")[1]).join(" / ")}\n   cited : ${[...nKeys].map((k) => k.split("|")[1]).join(" / ")}`);
    }
  } else identical += 1;

  // SAFETY. Every printed row must come from a fact an issuer could already see.
  const byId = new Map(facts.map((f) => [f.id, f]));
  for (const row of printsNew ? N.rows : []) {
    const f = byId.get(row.factId);
    if (!f || !isBankIncludedFact(f) || f.submissionRisk || !f.bankEligible) adverseLeak += 1;
    const field = f ? evidenceFieldOfFact(f) : null;
    if (field && !KNOWN_ITEM_FIELDS.has(field)) count(unrepresented, field);
  }
  // Anything the legacy table printed that is NOT record context must survive;
  // record-context rows survive exactly when the letter's printed argument cites them.
  const nLabels = new Set((printsNew ? N.rows : []).map((x) => x.label));
  for (const row of printsLegacy ? L.rows : []) {
    const f = byId.get(row.factId);
    const isContext = f?.strength === "supporting" && ["order_confirmation", "refund_policy", "shipping_policy"].includes(String(f.value?.fieldKey));
    if (!isContext && !nLabels.has(row.label)) previouslyCitedGone += 1;
    if (isContext && f) {
      if (argued.has(f.id)) {
        contextArguedLegacy += 1;
        if (nLabels.has(row.label)) contextArguedKept += 1;
      } else {
        contextUnargued += 1;
        if (nLabels.has(row.label)) contextUnarguedStillListed += 1;
      }
    }
  }
  // PROPERTY: every bank-included fact a printed argument cites is listed, bar a delivery under its card.
  for (const id of argued) {
    const f = byId.get(id);
    if (!f || !isBankIncludedFact(f)) continue;
    const delivery = f.category === "delivery_proof" || f.category === "shipping_tracking";
    // Facts the legacy rule's own row builder also yields no row for (nothing
    // citable to print, or an identical row already printed) are not this change's.
    const legacyHasRow = buildEvidenceBasisRows(facts).some((x) => x.factId === id);
    if (!delivery && legacyHasRow && !(printsNew ? N.rows : []).some((x) => x.factId === id)) {
      arguedButUnlisted += 1;
      count(unlistedWhy, `${f.category}${f.strength === "supporting" ? "/supporting" : ""}${N.multiParcel ? "/multi" : ""}`);
    }
  }
}

const fmt = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join("\n  ");
console.log(`packages: ${rows.length}  shops: ${shops.size}  multi-parcel: ${multiParcel}`);
console.log(`families:\n  ${fmt(byFamily)}`);
console.log(`packages whose table changes: ${changed}  identical: ${identical}`);
console.log(`table rows: legacy ${legacyRows}  cited ${newRows}`);
console.log(`table newly appears: ${tableAppears}  disappears: ${tableDisappears}`);
console.log(`rows REMOVED (by label):\n  ${fmt(removed)}`);
console.log(`rows ADDED (by label):\n  ${fmt(added)}`);
console.log(`ADVERSE/INTERNAL rows newly visible (must be 0): ${adverseLeak}`);
console.log(`non-context legacy rows that vanish (must be 0): ${previouslyCitedGone}`);
console.log(`record-context rows the legacy table listed: argued by the letter ${contextArguedLegacy} (kept ${contextArguedKept}), not argued ${contextUnargued} (still listed ${contextUnarguedStillListed}, must be 0)`);
console.log(`bank-included facts a printed argument cites but the table omits (must be 0): ${arguedButUnlisted}`);
console.log(`  by category:\n  ${fmt(unlistedWhy)}`);
console.log(`cited fields with no item on the dispute page:\n  ${fmt(unrepresented) || "(none)"}`);
console.log(`examples:\n${examples.join("\n")}`);
