/**
 * REAL counsel letters through the Evidence Basis.
 *
 * Counsel v2 writes every printed section with `usedFactIds = ALL fact ids`
 * (`toNarrative`), so the narrative alone cannot say which records a letter
 * relies on. The build therefore derives the relied-on set from the claim
 * ledger (`argumentFactIdsOfDraft`) and stores it in the provenance column.
 * These tests run the real ledger builders, the real `writeLetter` (model
 * stubbed), the real `toNarrative`, then draw the table with the preview, the
 * PDF data path and `letterCitations`, and assert a policy / order-record row is
 * listed iff a printed claim of THAT letter relies on it.
 */
import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/en.json";
import { DefencePackageHtmlView } from "@/app/(embedded)/app/disputes/[id]/tabs/sections/DefencePackageHtmlView";
import { DefencePackageDocument, type DefencePackageDocumentData } from "@/lib/defence/pdf/DefencePackageDocument";
import { composePdfBlocks } from "@/lib/defence/pdf/composePdfBlocks";
import { buildDocumentProvenance } from "@/lib/defence/package/documentProvenance";
import { argumentFactIdsBySlot, argumentFactIdsOfDraft, toNarrative } from "@/lib/defence/counsel/checks";
import { narrativeJson } from "../fixtures/defencePackageShapes";
import { CREDIT_NOT_PROCESSED_BRIEF } from "@/lib/defence/counsel/briefs";
import { buildCreditNotProcessedLedger } from "@/lib/defence/counsel/creditNotProcessedLedger";
import { buildItemNotReceivedLedger } from "@/lib/defence/counsel/claimLedger";
import { disputeFrame, requestLine } from "@/lib/defence/counsel/frame";
import { writeLetter, type ModelCall } from "@/lib/defence/counsel/generate";
import { NOT_AS_DESCRIBED } from "@/lib/defence/counsel/playbooks";
import { ledgerForBrief } from "@/lib/defence/counsel/run";
import { argumentFactIdsFromClaims, argumentFactIdsOfLetter, CURRENT_EVIDENCE_BASIS_RULE } from "@/lib/defence/citedFacts";
import { letterCitations } from "@/lib/disputes/letterCitations";
import type { CounselDraft, LedgerClaim, LedgerInput } from "@/lib/defence/counsel/types";
import type { DefenceNarrativeOutput, EvidenceFact } from "@/lib/defence/types";

const frame = disputeFrame({ paymentFamily: "klarna", paymentLabel: "Klarna", phase: "inquiry" });

function fact(id: string, category: string, label: string, strength: EvidenceFact["strength"], value: Record<string, unknown>): EvidenceFact {
  return {
    id, category: category as never, label, value, source: "shopify_order", sourceRef: null, strength,
    bankEligible: true, merchantVisible: true, internalOnly: false, includeInBankNarrative: true, submissionRisk: false, confidence: null,
  };
}
const DELIVERY = { proofType: "delivered_confirmed", carrier: "PostNord", trackingNumber: "PN1", deliveredAt: "2026-10-17T14:55:00Z" };
const FACTS: EvidenceFact[] = [
  fact("order_confirmation#0", "order_record", "Order record", "supporting", { fieldKey: "order_confirmation" }),
  fact("delivery#0", "delivery_proof", "Delivery confirmation", "moderate", { ...DELIVERY, fieldKey: "delivery_proof" }),
  fact("no_return_initiated#0", "no_return_initiated", "No return recorded in Shopify", "moderate", { returnStatus: "NO_RETURN", returnInitiated: false, fieldKey: "no_return_initiated" }),
  fact("refund_policy#0", "policy_refund", "Refund policy", "supporting", { fieldKey: "refund_policy", publishedOnStore: true, publishedUrl: "https://store.example/policies/refund" }),
];

function cnpInput(): LedgerInput {
  return {
    moduleKey: "credit_not_processed",
    facts: FACTS,
    orderName: "#17615",
    disputeOpenedAt: "2026-10-30T08:35:00Z",
    disputeAmount: 2600,
    disputeCurrency: "SEK",
    customerOrders: [],
    packSections: [
      { type: "order", source: "shopify_order", data: { orderName: "#17615", createdAt: "2026-10-14T12:10:00Z" } },
      { type: "order", source: "shopify_order", data: { returnStatus: "NO_RETURN" } },
      {
        type: "shipping",
        source: "shopify_fulfillments",
        data: { fulfillments: [{ createdAt: "2026-10-15T15:33:00Z", deliveredAt: "2026-10-17T14:55:00Z", shipmentProofType: "delivered_confirmed", tracking: [{ number: "PN1", carrier: "PostNord" }] }] },
      },
    ],
  };
}

const CLEAN = JSON.stringify({ errors: [], unclear: [] });

async function counselLetter(ledger: LedgerClaim[], reply: object, facts: EvidenceFact[]) {
  const request = requestLine(frame);
  const raw = JSON.stringify({
    ...reply,
    summary: [`${(reply as { summaryText: string }).summaryText} ${request}`],
  });
  const call: ModelCall = async ({ stage }) => (stage === "write" ? raw : CLEAN);
  const r = await writeLetter({
    ledger,
    brief: CREDIT_NOT_PROCESSED_BRIEF,
    frame,
    merchantName: "Cay Collective",
    pageContext: "Header: …",
    check: {
      ledger, playbook: NOT_AS_DESCRIBED, brief: CREDIT_NOT_PROCESSED_BRIEF, facts, disputeOpenedAt: "2026-10-30T08:35:00Z",
      merchantName: "Cay Collective", carrierName: "PostNord", pageIdentifiers: ["#17615", "17615"], trackingUrl: null, frame,
    },
    call,
  });
  const draft: CounselDraft = r.draft;
  const narrative = toNarrative(draft, facts.map((f) => f.id), null, ledger) as DefenceNarrativeOutput;
  const argumentFactIds = argumentFactIdsOfDraft(draft, ledger, facts);
  return { draft, narrative, argumentFactIds, ok: r.ok };
}

const WITH_POLICY = {
  summaryText:
    "The customer says a refund owed on this order was not processed. No return has been recorded in Shopify for this order. " +
    "The store's refund policy is published on the store, and the carrier recorded delivery of the order before the dispute was opened. " +
    "The claim that a refund is outstanding is not supported by the record.",
  summaryClaimIds: ["claim_is_credit_not_processed", "no_return_recorded", "refund_policy_published", "carrier_delivered"],
  sections: { shipping: { text: "The delivery shown on the shipment card is the carrier's own scan.", claimIds: ["carrier_delivered"] } },
  conclusion: {
    text: "The order was delivered. No return is recorded in Shopify for this order. The claim that a refund is outstanding is not supported by the record.",
    claimIds: ["carrier_delivered", "no_return_recorded"],
  },
};
const NO_POLICY = {
  summaryText:
    "The customer says a refund owed on this order was not processed. No return has been recorded in Shopify for this order. " +
    "The carrier recorded delivery of the order before the dispute was opened. The claim that a refund is outstanding is not supported by the record.",
  summaryClaimIds: ["claim_is_credit_not_processed", "no_return_recorded", "carrier_delivered"],
  sections: WITH_POLICY.sections,
  conclusion: WITH_POLICY.conclusion,
};

/* ── draw the table three ways ── */

function previewText(facts_: EvidenceFact[], narrative: DefenceNarrativeOutput, provenance: unknown): string {
  const row = {
    id: "p", version: 1, status: "draft", package_mode: "full", generated_at: "2026-11-06T04:32:48Z", pdf_path: "x.pdf", evidence_hash: "h",
    llm_model: null, prompt_family: null, prompt_version: null, reason_code_module: null, validation_status: "ok",
    narrative_json: narrative, facts_json: facts_, document_provenance_json: provenance,
  };
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages as never}>
      <DefencePackageHtmlView row={row as never} dispute={{ orderName: "#17615", shopId: null } as never} />
    </NextIntlClientProvider>,
  );
  const text = html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const i = text.indexOf("Evidence Basis");
  return i < 0 ? "" : text.slice(i, text.indexOf("Chronology", i) < 0 ? undefined : text.indexOf("Chronology", i));
}

function printed(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return out;
  if (typeof node === "string" || typeof node === "number") return (out.push(String(node)), out);
  if (Array.isArray(node)) return (node.forEach((n) => printed(n, out)), out);
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (typeof el.type === "function") printed((el.type as (p: unknown) => unknown)(el.props ?? {}), out);
  else if (el.props) printed(el.props.children, out);
  return out;
}

function pdfText(facts_: EvidenceFact[], narrative: DefenceNarrativeOutput, argued: string[]): string {
  const composedBlocks = composePdfBlocks({
    narrative, approvedFacts: facts_, packageMode: "full", familyKey: "credit_not_processed" as never, moduleKey: null, fulfillmentStatus: null,
  });
  const data = {
    meta: {
      packageId: "p", disputeGid: "gid://shopify/Dispute/1", orderName: "#17615", reasonCode: "x", reasonCodeDisplay: "x", claimType: "x",
      shopName: "S", merchantName: "S", amountDisplay: "SEK 2600", cardNetwork: "Klarna", transactionDate: "2026-10-14T12:10:00Z",
      generatedAt: "2026-11-06T04:32:48Z", version: 1, packageMode: "full", promptVersion: 2, modelUsed: "m",
    },
    composedBlocks, approvedFacts: facts_, manualEvidence: [], evidenceBasisRule: CURRENT_EVIDENCE_BASIS_RULE, evidenceBasisArgued: argued,
  } as unknown as DefencePackageDocumentData;
  return printed(DefencePackageDocument({ data })).join(" ").replace(/\s+/g, " ");
}

describe("a real counsel letter (credit not processed)", () => {
  it("every printed section carries ALL fact ids: the narrative cannot say what the letter relies on", async () => {
    const ledger = buildCreditNotProcessedLedger(cnpInput())!;
    const { narrative, argumentFactIds } = await counselLetter(ledger, WITH_POLICY, FACTS);
    expect(narrative.policyArgument.usedFactIds).toEqual([]); // no policy section
    expect(narrative.executiveSummary.usedFactIds).toHaveLength(FACTS.length);
    expect(narrative.conclusion.usedFactIds).toHaveLength(FACTS.length);
    // ...while the claims name only what the letter used
    expect(argumentFactIds).toContain("refund_policy#0");
    expect(argumentFactIds).not.toContain("order_confirmation#0");
  });

  it("the letter argues from the refund policy: table row, PDF row and page all say so", async () => {
    const ledger = buildCreditNotProcessedLedger(cnpInput())!;
    const { narrative, argumentFactIds } = await counselLetter(ledger, WITH_POLICY, FACTS);
    const provenance = buildDocumentProvenance({ blocks: [], composedFacts: FACTS, evidenceBasisRule: 2, argumentFactIds });
    expect(previewText(FACTS, narrative, provenance)).toContain("Published on the store");
    expect(pdfText(FACTS, narrative, argumentFactIds)).toContain("Published on the store");
    const page = letterCitations({ facts_json: FACTS, narrative_json: narrative, document_provenance_json: provenance, status: "final", pdf_path: "x.pdf" });
    expect(page?.citedFields).toContain("refund_policy");
    // the order record is not relied on by any printed claim: not listed anywhere
    expect(previewText(FACTS, narrative, provenance)).not.toContain("Order on record");
    expect(pdfText(FACTS, narrative, argumentFactIds)).not.toContain("Order on record");
    expect(page?.citedFields).not.toContain("order_confirmation");
  });

  it("a letter with no policy claim does not list the policy (preview, PDF, page)", async () => {
    const ledger = buildCreditNotProcessedLedger(cnpInput())!;
    const { narrative, argumentFactIds } = await counselLetter(ledger, NO_POLICY, FACTS);
    expect(argumentFactIds).not.toContain("refund_policy#0");
    const provenance = buildDocumentProvenance({ blocks: [], composedFacts: FACTS, evidenceBasisRule: 2, argumentFactIds });
    expect(previewText(FACTS, narrative, provenance)).not.toContain("Published on the store");
    expect(pdfText(FACTS, narrative, argumentFactIds)).not.toContain("Published on the store");
    const page = letterCitations({ facts_json: FACTS, narrative_json: narrative, document_provenance_json: provenance, status: "final", pdf_path: "x.pdf" });
    expect(page?.citedFields).not.toContain("refund_policy");
    // what the letter does rely on is still cited
    expect(page?.citedFields).toContain("no_return_initiated");
    // the old behaviour: provenance without the claim set falls back to the narrative's all-facts ids and lists everything
    const legacyLike = { evidenceBasisRule: 2 };
    expect(previewText(FACTS, narrative, legacyLike)).toContain("Published on the store");
  });

  it("the general brief (no recorded absence, no delivery) goes through the same path", () => {
    const bare = { ...cnpInput(), facts: [], packSections: [{ type: "order", source: "shopify_order", data: { orderName: "#17615", createdAt: "2026-10-14T12:10:00Z" } }] } as LedgerInput;
    const got = ledgerForBrief(CREDIT_NOT_PROCESSED_BRIEF, bare, null)!;
    expect(got.brief.type).toBe("general");
    const ids = argumentFactIdsOfDraft(
      { summary: { paragraphs: ["x"], claimIds: got.ledger.map((c) => c.id) }, evidenceSections: [], conclusion: { paragraphs: [], claimIds: [] } },
      got.ledger,
      [],
    );
    expect(ids).toEqual([]);
  });
});

describe("a real counsel letter (item not received): the shipping policy", () => {
  const POLICY_FACT = fact("shipping_policy#0", "policy_shipping", "Shipping policy", "supporting", { fieldKey: "shipping_policy", publishedOnStore: true });
  const NR_FACTS: EvidenceFact[] = [
    fact("order_confirmation#0", "order_record", "Order record", "supporting", { fieldKey: "order_confirmation" }),
    fact("delivery#0", "delivery_proof", "Delivery confirmation", "moderate", { ...DELIVERY, fieldKey: "delivery_proof" }),
    POLICY_FACT,
  ];
  const nrInput = (): LedgerInput => ({
    moduleKey: "inr_product_not_received",
    facts: NR_FACTS,
    orderName: "#17615",
    disputeOpenedAt: "2026-10-30T08:35:00Z",
    disputeAmount: 2600,
    disputeCurrency: "SEK",
    customerOrders: [],
    packSections: [
      { type: "order", source: "shopify_order", data: { orderName: "#17615", createdAt: "2026-10-14T12:10:00Z", lineItems: [{ lineItemId: "L1", quantity: 1, title: "Lamp" }] } },
      {
        type: "shipping",
        source: "shopify_fulfillments",
        data: { fulfillments: [{ createdAt: "2026-10-15T15:33:00Z", deliveredAt: "2026-10-17T14:55:00Z", shipmentProofType: "delivered_confirmed", tracking: [{ number: "PN1", carrier: "PostNord" }], items: [{ lineItemId: "L1", quantity: 1 }] }] },
      },
      { type: "shipping_policy", source: "policy_snapshots", data: { policies: [{ textPreview: "We ship within 1-3 business days." }] } },
    ],
  });

  it("the policy row is listed iff a printed claim names the shipping policy", () => {
    const ledger = buildItemNotReceivedLedger(nrInput())!;
    const ids = ledger.map((c) => c.id);
    expect(ids).toContain("within_shipping_policy");
    const draftWith: CounselDraft = {
      summary: { paragraphs: ["x"], claimIds: ["carrier_delivered"] },
      evidenceSections: [{ key: "shipping", paragraphs: ["The order shipped within the published shipping policy."], claimIds: ["carrier_delivered", "within_shipping_policy"] }],
      conclusion: { paragraphs: ["y"], claimIds: ["carrier_delivered"] },
    };
    const draftWithout: CounselDraft = {
      ...draftWith,
      evidenceSections: [{ key: "shipping", paragraphs: ["The delivery shown on the card is the carrier's own scan."], claimIds: ["carrier_delivered"] }],
    };
    const withIds = argumentFactIdsOfDraft(draftWith, ledger, NR_FACTS);
    const withoutIds = argumentFactIdsOfDraft(draftWithout, ledger, NR_FACTS);
    expect(withIds).toContain("shipping_policy#0");
    expect(withoutIds).not.toContain("shipping_policy#0");
    for (const [d, argued, expectRow] of [[draftWith, withIds, true], [draftWithout, withoutIds, false]] as const) {
      const narrative = toNarrative(d, NR_FACTS.map((f) => f.id), null, ledger) as DefenceNarrativeOutput;
      const provenance = buildDocumentProvenance({ blocks: [], composedFacts: NR_FACTS, evidenceBasisRule: 2, argumentFactIds: argued });
      expect(previewText(NR_FACTS, narrative, provenance).includes("Published on the store")).toBe(expectRow);
      expect(pdfText(NR_FACTS, narrative, argued).includes("Published on the store")).toBe(expectRow);
      const page = letterCitations({ facts_json: NR_FACTS, narrative_json: narrative, document_provenance_json: provenance, status: "final", pdf_path: "x.pdf" });
      expect(page?.citedFields.includes("shipping_policy")).toBe(expectRow);
    }
  });

  it("a claim derived from the order (the items shipped) makes the order record cited", () => {
    const ledger = buildItemNotReceivedLedger(nrInput())!;
    const claim = ledger.find((c) => c.sources.some((s) => s.startsWith("pack.order.")));
    expect(claim).toBeDefined();
    const ids = argumentFactIdsOfDraft(
      { summary: { paragraphs: ["x"], claimIds: [claim!.id] }, evidenceSections: [], conclusion: { paragraphs: [], claimIds: [] } },
      ledger,
      NR_FACTS,
    );
    expect(ids).toContain("order_confirmation#0");
  });
});

/* ── the relied-on set of a FINISHED letter ── */

describe("argumentFactIdsOfLetter / argumentFactIdsFromClaims", () => {
  const F = [
    { id: "order#0", value: { fieldKey: "order_confirmation" } },
    { id: "ship_policy#0", value: { fieldKey: "shipping_policy" } },
    { id: "refund_policy#0", value: { fieldKey: "refund_policy" } },
    { id: "delivery#0", value: { fieldKey: "delivery_proof" } },
  ];
  const claim = (id: string, sources: string[]) => ({ id, sources });

  it.each([
    ["pack.order.lineItems", "order#0"],
    ["pack.order.createdAt", "order#0"],
    ["pack.order.totals.presentment", "order#0"],
    ["pack.order.shippingAddressFull", "order#0"],
    ["pack.order.billingAddressFull", "order#0"],
    ["pack.shipping_policy", "ship_policy#0"],
    ["policy_snapshots.extracted_text", "refund_policy#0"],
    ["delivery#0", "delivery#0"],
  ])("a claim sourced from %s relies on %s", (source, factId) => {
    expect(argumentFactIdsFromClaims([["c"]], [claim("c", [source])], F)).toEqual([factId]);
  });

  it.each(["pack.order.returnStatus", "dispute.reason", "pack.payment.avsResultCode", "pack.shipping.fulfillments.items"])(
    "a claim sourced from %s relies on no store record",
    (source) => {
      expect(argumentFactIdsFromClaims([["c"]], [claim("c", [source])], F)).toEqual([]);
    },
  );

  const narrativeWith = (slots: Record<string, string>, omitted: string[] = []) => {
    const n = narrativeJson({}) as unknown as Record<string, any>;
    for (const [k, text] of Object.entries(slots)) n[k] = { text, usedFactIds: [] };
    n.omittedSections = omitted.map((sectionKey) => ({ sectionKey, reason: "x" }));
    return n as unknown as DefenceNarrativeOutput;
  };

  it("only slots that still print count: a section emptied or omitted after the draft is dropped", () => {
    const bySlot = { executiveSummary: ["delivery#0"], fulfillmentArgument: ["order#0"], policyArgument: ["ship_policy#0"] };
    const kept = argumentFactIdsOfLetter(bySlot, narrativeWith({ executiveSummary: "Delivered.", fulfillmentArgument: "Shipped.", policyArgument: "x" }), F);
    expect(kept).toEqual(["delivery#0", "order#0", "ship_policy#0"]);
    const dropped = argumentFactIdsOfLetter(bySlot, narrativeWith({ executiveSummary: "Delivered.", fulfillmentArgument: "", policyArgument: "x" }, ["policyArgument"]), F);
    expect(dropped).toEqual(["delivery#0"]);
  });

  it("a printed sentence that names a store policy lists it even when no claim id does", () => {
    const n = narrativeWith({ executiveSummary: "The store's refund policy is published on the store." });
    expect(argumentFactIdsOfLetter({}, n, F)).toEqual(["refund_policy#0"]);
    expect(argumentFactIdsOfLetter({}, narrativeWith({ executiveSummary: "The carrier recorded delivery." }), F)).toEqual([]);
    // an omitted section's sentence prints nothing
    expect(argumentFactIdsOfLetter({}, narrativeWith({ policyArgument: "The shipping policy is published." }, ["policyArgument"]), F)).toEqual([]);
  });

  it("the address card prints from the order record, so the order record is relied on", () => {
    const n = narrativeWith({ executiveSummary: "x" });
    (n as unknown as { addressExhibit: object }).addressExhibit = { shippingLines: [], billingLines: [] };
    expect(argumentFactIdsOfLetter({}, n, F)).toEqual(["order#0"]);
  });

  it("a draft section with claim ids but no text relies on nothing", () => {
    const ledger = [claim("pol", ["pack.shipping_policy"])] as never[];
    const d: CounselDraft = {
      summary: { paragraphs: ["x"], claimIds: [] },
      evidenceSections: [{ key: "policy", paragraphs: ["  "], claimIds: ["pol"] }],
      conclusion: { paragraphs: [], claimIds: [] },
    };
    expect(argumentFactIdsBySlot(d, ledger, F)).toEqual({ executiveSummary: [] });
  });
});

describe("the build job passes ONE relied-on set to both the PDF and the provenance column", () => {
  it("the PDF's evidenceBasisArgued and the stored argumentFactIds are the same variable, computed from the final narrative", async () => {
    const fs = await import("node:fs");
    const job = fs.readFileSync("lib/jobs/handlers/buildDefencePackageJob.ts", "utf8");
    expect(job).toMatch(/const reliedOnFactIds = argumentFactIdsOfLetter\(counselRes\.argumentFactIdsBySlot, narrativeRes\.narrative, planFacts\)/);
    expect(job).toMatch(/evidenceBasisArgued: reliedOnFactIds/);
    expect(job).toMatch(/argumentFactIds: reliedOnFactIds/);
    expect(job.indexOf("const reliedOnFactIds")).toBeLessThan(job.indexOf("evidenceBasisArgued: reliedOnFactIds"));
    const run = fs.readFileSync("lib/defence/counsel/run.ts", "utf8");
    expect(run).toMatch(/argumentFactIdsBySlot: argumentFactIdsBySlot\(draft, ledger, args\.facts\)/);
  });
});
