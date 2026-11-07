/**
 * The GATE, tested at the renderers (not only in the pure derivation).
 *
 * The letter's Evidence Basis is drawn by two renderers: the in-app preview
 * (`DefencePackageHtmlView`) and the PDF (`DefencePackageDocument`). Each reads
 * the rule from a different place (the row's provenance stamp / the document
 * data). These tests render BOTH over the same facts with and without the
 * stamp, so a renderer that stopped honouring the stamp — or started applying
 * the new rule to unstamped packages — turns them red:
 *
 *   mutation 1: `evidenceBasisRuleOf(row.document_provenance_json)` -> `CURRENT_EVIDENCE_BASIS_RULE`
 *               in DefencePackageHtmlView.tsx  => "legacy preview keeps Order record" fails
 *   mutation 2: `data.evidenceBasisRule ?? EVIDENCE_BASIS_RULE_LEGACY` -> `?? CURRENT_EVIDENCE_BASIS_RULE`
 *               in DefencePackageDocument.tsx  => "legacy PDF keeps Order record" fails
 *
 * It also feeds the REAL classifier the adverse inputs (AVS mismatch, a CANCEL
 * screening, a different-country IP, a different cardholder name) and asserts
 * none of them is cited or listed.
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/en.json";
import { DefencePackageHtmlView } from "@/app/(embedded)/app/disputes/[id]/tabs/sections/DefencePackageHtmlView";
import { DefencePackageDocument, type DefencePackageDocumentData } from "@/lib/defence/pdf/DefencePackageDocument";
import { composePdfBlocks } from "@/lib/defence/pdf/composePdfBlocks";
import { classifyFacts, type ClassifyFactsInput } from "@/lib/defence/factClassifier";
import { argumentFactIdsOfNarrative, citedFacts } from "@/lib/defence/citedFacts";
import { buildEvidenceBasisRows } from "@/lib/defence/pdf/evidenceBasisRows";
import type { DefenceNarrativeOutput, EvidenceFact } from "@/lib/defence/types";
import { narrativeJson } from "../fixtures/defencePackageShapes";
import { SHAPES, type Shape } from "../fixtures/evidenceBasisShapes";

const shape = (name: string) => SHAPES.find((s) => s.name === name) as Shape;
const narrative = () => narrativeJson({ executiveSummary: "The carrier recorded delivery." }) as unknown as DefenceNarrativeOutput;

/* ── the preview ── */

function previewEvidenceBasis(s: Shape, stamp: unknown, n: DefenceNarrativeOutput = narrative()): string {
  const row = {
    id: "pkg-1",
    version: 1,
    status: "draft",
    package_mode: "full",
    generated_at: "2026-11-06T04:32:48Z",
    pdf_path: "x.pdf",
    evidence_hash: "h",
    llm_model: null,
    prompt_family: null,
    prompt_version: null,
    reason_code_module: null,
    validation_status: "ok",
    narrative_json: n,
    facts_json: s.facts,
    document_provenance_json: stamp,
  };
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages as never}>
      <DefencePackageHtmlView row={row as never} dispute={{ orderName: "#368528", shopId: null } as never} />
    </NextIntlClientProvider>,
  );
  const text = html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const i = text.indexOf("Evidence Basis");
  if (i < 0) return "";
  const j = text.indexOf("Chronology", i);
  return text.slice(i, j < 0 ? undefined : j);
}

describe("the in-app preview honours the stamp", () => {
  const s = shape("captured:open_368528_v1");
  it("legacy preview (no stamp) keeps the Order record row", () => {
    const t = previewEvidenceBasis(s, undefined);
    expect(t).toContain("Order on record");
    expect(t).toContain("IP geolocation");
  });
  it("a null or unknown stamp is legacy too", () => {
    expect(previewEvidenceBasis(s, null)).toContain("Order on record");
    expect(previewEvidenceBasis(s, { evidenceBasisRule: 3 })).toContain("Order on record");
  });
  it("a stamped preview does not list the Order record as proof, and keeps the cited rows", () => {
    const t = previewEvidenceBasis(s, { evidenceBasisRule: 2 });
    expect(t).not.toContain("Order on record");
    expect(t).toContain("IP geolocation");
    expect(t).toContain("Shopify recommended ACCEPT");
    expect(t).toContain("No return recorded in Shopify");
  });
  it("a stamped preview lists a policy the printed argument relies on, and only then", () => {
    const c = shape("credit_not_processed");
    const policy = c.facts.find((f) => f.category === "policy_refund")?.id as string;
    const n = narrativeJson({ policyArgument: "The refund policy is published." }) as unknown as DefenceNarrativeOutput;
    n.policyArgument.usedFactIds = [policy];
    expect(previewEvidenceBasis(c, { evidenceBasisRule: 2 }, n)).toContain("Published on the store");
    expect(previewEvidenceBasis(c, { evidenceBasisRule: 2 })).not.toContain("Published on the store");
    // legacy lists it either way
    expect(previewEvidenceBasis(c, undefined)).toContain("Published on the store");
  });
});

/* ── the PDF's data path ── */

/** Expand the document's function components and collect every string it prints. */
function printed(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => printed(n, out));
    return out;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (typeof el.type === "function") {
    printed((el.type as (p: unknown) => unknown)(el.props ?? {}), out);
  } else if (el.props) {
    printed(el.props.children, out);
  }
  return out;
}

function pdfText(s: Shape, rule: number | undefined, n: DefenceNarrativeOutput = narrative()): string {
  const approvedFacts = s.facts as unknown as EvidenceFact[];
  const composedBlocks = composePdfBlocks({
    narrative: n,
    approvedFacts,
    packageMode: "full",
    familyKey: "unauthorized_fraud",
    moduleKey: null,
    fulfillmentStatus: null,
  });
  const data = {
    meta: {
      packageId: "p",
      disputeGid: "gid://shopify/Dispute/1",
      orderName: "#368528",
      reasonCode: "4837",
      reasonCodeDisplay: "Mastercard 4837",
      claimType: "Unauthorized transaction claim",
      shopName: "Shop",
      merchantName: "Shop",
      amountDisplay: "CAD 112.67",
      cardNetwork: "Mastercard",
      transactionDate: "2026-10-13T21:23:53Z",
      generatedAt: "2026-11-06T04:32:48Z",
      version: 1,
      packageMode: "full",
      promptVersion: 2,
      modelUsed: "m",
    },
    composedBlocks,
    approvedFacts,
    manualEvidence: [],
    ...(rule === undefined ? {} : { evidenceBasisRule: rule }),
  } as unknown as DefencePackageDocumentData;
  return printed(DefencePackageDocument({ data })).join(" ").replace(/\s+/g, " ");
}

describe("the PDF honours the rule it is handed", () => {
  const s = shape("captured:open_368528_v1");
  it("legacy PDF (no rule in the document data) keeps the Order record row", () => {
    const t = pdfText(s, undefined);
    expect(t).toContain("Evidence Basis");
    expect(t).toContain("Order on record");
  });
  it("a PDF built under rule 2 does not list the Order record as proof, and keeps the cited rows", () => {
    const t = pdfText(s, 2);
    expect(t).toContain("Evidence Basis");
    expect(t).not.toContain("Order on record");
    expect(t).toContain("IP geolocation");
    expect(t).toContain("No return recorded in Shopify");
  });
  it("rule 2 lists a policy the composed argument relies on, and only then", () => {
    const c = shape("credit_not_processed");
    const policy = c.facts.find((f) => f.category === "policy_refund")?.id as string;
    const n = narrativeJson({ policyArgument: "The refund policy is published." }) as unknown as DefenceNarrativeOutput;
    n.policyArgument.usedFactIds = [policy];
    expect(pdfText(c, 2, n)).toContain("Published on the store");
    expect(pdfText(c, 2)).not.toContain("Published on the store");
    expect(pdfText(c, undefined)).toContain("Published on the store");
  });
});

/* ── adverse facts, from the REAL classifier ── */

describe("facts the real classifier keeps internal are never cited or listed", () => {
  const input = (): ClassifyFactsInput => ({
    packageId: "pkg_1",
    sections: [
      // AVS mismatch with a different cardholder name
      { type: "payment", label: "Payment authentication", source: "shopify_order", data: { avsResultCode: "N", cvvResultCode: "M", cardCompany: "Visa", cardholderName: "Somebody Else" }, fieldsProvided: ["avs_cvv_match"] },
      // a CANCEL screening, exactly as `collectFraudRiskEvidence` emits the
      // unfavourable verdict (its internal-only path: no positive facts)
      { type: "other", label: "Fraud screening", source: "shopify_order_risk_assessments", data: { provider: "shopify", recommendation: "CANCEL", riskLevel: "HIGH", positiveFacts: [], negativeFacts: ["Shipping address is far from the IP address"], isNegativeVerdict: true }, fieldsProvided: ["fraud_risk_screening"] },
      // a different-country, anonymised IP
      { type: "device", label: "IP", source: "ipinfo_io", data: { locationMatch: "different_country", bankEligible: false, ipinfo: { privacy: { vpn: true } } }, fieldsProvided: ["ip_location_check"] },
      // the store's own record, which may be cited only if argued
      { type: "order", label: "Order", source: "shopify_order", data: { channel: "web" }, fieldsProvided: ["order_confirmation"] },
    ],
    evidenceItems: [],
    checklist: [],
    coverage: { state: "not_covered" },
    fatalLoss: { triggered: false, reason: null },
    caseStrength: "moderate",
    manualRows: [],
    reasonCodeModule: {
      allowedFactCategories: ["payment_authentication", "fraud_screening", "ip_location", "order_record"],
      criticalCategories: [],
    } as unknown as ClassifyFactsInput["reasonCodeModule"],
  } as unknown as ClassifyFactsInput);

  it("none of AVS mismatch, CANCEL screening, different-country IP or a different name is cited", () => {
    const r = classifyFacts(input());
    // Worst case: hand EVERY classified fact to the renderer, approved or not,
    // and let a narrative cite them all.
    const all = [...r.approved, ...r.internalOnly, ...r.submissionRisk] as EvidenceFact[];
    const n = narrativeJson({ policyArgument: "x", paymentAuthenticationArgument: "y" }) as unknown as DefenceNarrativeOutput;
    n.policyArgument.usedFactIds = all.map((f) => f.id);
    n.paymentAuthenticationArgument.usedFactIds = all.map((f) => f.id);
    const argued = argumentFactIdsOfNarrative(n, null);
    const cited = citedFacts(all, argued);
    const rows = buildEvidenceBasisRows(all, 2, argued);
    const text = JSON.stringify([cited.map((f) => [f.category, f.value]), rows]);
    expect(text).not.toMatch(/Somebody Else|CANCEL|different_country|"avsResultCode":"N"/);
    for (const f of cited) {
      expect(["payment_authentication", "fraud_screening", "ip_location"]).not.toContain(f.category);
    }
    // sanity: the classifier did produce the adverse facts (the test is not vacuous)
    expect(all.some((f) => f.category === "payment_authentication")).toBe(true);
  });
});
