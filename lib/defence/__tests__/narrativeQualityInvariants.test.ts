/**
 * Narrative quality invariants — locks in the four 2026-05-19 fixes.
 *
 * Each test reflects a real bank-facing readability problem caught on
 * a live Visa 10.4 dispute and fixed at the source-of-truth layer:
 *
 *   1. Raw AVS/CVV gateway codes (Y/M/N/etc.) must not appear in any
 *      narrative section. The fact value carries a translated
 *      `verificationSummary` string the LLM is told to quote instead.
 *   2. Shopify's `fulfillmentStatus` enum (UNFULFILLED/FULFILLED/
 *      PARTIAL) is order-system jargon, not bank-facing evidence; it
 *      must not appear in any narrative section for any reason code.
 *   3. The `policyArgument` section is deny-listed for the
 *      `visa_10_4_fraud` reason-code module — refund/shipping/
 *      cancellation policies do not refute an unauthorized-transaction
 *      claim. The renderer drops the section regardless of LLM emission.
 *   4. The chronology thesis must not over-promise event categories
 *      the deterministic timeline doesn't actually carry (no claims
 *      of "site engagement" or "session traceability" — the timeline
 *      only renders transaction date + auth captured + customer
 *      communication if present).
 */

import { describe, it, expect } from "vitest";
import { extractValueForTest as extractValue } from "../factClassifier";
import { FORBIDDEN_PHRASES } from "../validateNarrative";
import { isSectionDeniedForModule } from "../sectionVisibility";
import { composePdfBlocks } from "../pdf/composePdfBlocks";
import type {
  DefenceNarrativeOutput,
  EvidenceFact,
  NarrativeSection,
  NarrativeSectionKey,
} from "../types";

function section(text = "", usedFactIds: string[] = []): NarrativeSection {
  return { text, usedFactIds };
}
function narrative(
  overrides: Partial<Record<NarrativeSectionKey, NarrativeSection>> = {},
): DefenceNarrativeOutput {
  return {
    executiveSummary: section(),
    transactionOverviewArgument: section(),
    chronologyArgument: section(),
    paymentAuthenticationArgument: section(),
    fulfillmentArgument: section(),
    communicationArgument: section(),
    policyArgument: section(),
    manualEvidenceArgument: section(),
    conclusion: section(),
    omittedSections: [],
    warnings: [],
    ...overrides,
  };
}
function fact(overrides: Partial<EvidenceFact> = {}): EvidenceFact {
  return {
    id: "f0",
    category: "payment_authentication",
    label: "Payment authentication",
    value: {},
    source: "shopify_order",
    sourceRef: null,
    strength: "strong",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
    ...overrides,
  };
}

describe("Invariant 1 — avs_cvv_match fact carries a translated verificationSummary", () => {
  it("emits a plain-language summary for AVS=Y + CVV=M", () => {
    const v = extractValue("avs_cvv_match", {
      avsResultCode: "Y",
      cvvResultCode: "M",
    });
    expect(v).toMatchObject({
      avsResult: "Y",
      cvvResult: "M",
    });
    expect(typeof v.verificationSummary).toBe("string");
    expect(v.verificationSummary).toMatch(/billing address matched/i);
    expect(v.verificationSummary).toMatch(/card verification code matched/i);
    expect(v.verificationSummary).not.toMatch(/\bY\b/);
    expect(v.verificationSummary).not.toMatch(/\bM\b/);
  });

  it("returns null verificationSummary when both codes are absent", () => {
    const v = extractValue("avs_cvv_match", {});
    expect(v.verificationSummary).toBeNull();
  });

  it("emits a partial summary when only AVS or only CVV is present", () => {
    const avsOnly = extractValue("avs_cvv_match", { avsResultCode: "Y" });
    expect(avsOnly.verificationSummary).toMatch(/billing address matched/i);
    expect(avsOnly.verificationSummary).not.toMatch(/card verification code/i);

    const cvvOnly = extractValue("avs_cvv_match", { cvvResultCode: "M" });
    expect(cvvOnly.verificationSummary).toMatch(/card verification code matched/i);
    expect(cvvOnly.verificationSummary).not.toMatch(/billing address/i);
  });
});

describe("Invariant 1b — narrative validator rejects raw AVS/CVV codes in prose", () => {
  it("matches AVS Y / CVV M / AVS result of Y patterns", () => {
    const samples = [
      "an AVS result of 'Y' and a CVV result of 'M'",
      "AVS Y and CVV M on file",
      "the AVS result was Y",
      "CVV result of M",
    ];
    for (const s of samples) {
      const hit = FORBIDDEN_PHRASES.some((p) => p.test(s));
      expect(hit, `expected forbidden match for: ${s}`).toBe(true);
    }
  });

  it("does NOT flag the translated summary phrasing", () => {
    const samples = [
      "the billing address matched the issuer's records",
      "the card verification code matched the issuer's records",
      "the available payment authentication signals are consistent with a cardholder-initiated transaction",
    ];
    for (const s of samples) {
      const hit = FORBIDDEN_PHRASES.some((p) => p.test(s));
      expect(hit, `unexpected forbidden match in: ${s}`).toBe(false);
    }
  });
});

describe("Invariant 2 — narrative validator rejects fulfillmentStatus leaks", () => {
  it("matches 'fulfillment status of UNFULFILLED' and bare 'UNFULFILLED'", () => {
    const samples = [
      "fulfillment status of UNFULFILLED at the time of this response",
      "fulfillment status of FULFILLED",
      "The order is UNFULFILLED.",
    ];
    for (const s of samples) {
      const hit = FORBIDDEN_PHRASES.some((p) => p.test(s));
      expect(hit, `expected forbidden match for: ${s}`).toBe(true);
    }
  });

  it("does NOT flag neutral order-record prose", () => {
    const samples = [
      "the order record was created at the time of purchase",
      "the available records indicate the order was placed via the web channel",
      "the payment was authorised with matching verification credentials",
    ];
    for (const s of samples) {
      const hit = FORBIDDEN_PHRASES.some((p) => p.test(s));
      expect(hit, `unexpected forbidden match in: ${s}`).toBe(false);
    }
  });
});

describe("Invariant 3 — policyArgument is deny-listed for visa_10_4_fraud", () => {
  it("isSectionDeniedForModule returns true for policyArgument + visa_10_4_fraud", () => {
    expect(isSectionDeniedForModule("policyArgument", "visa_10_4_fraud")).toBe(
      true,
    );
  });

  it("isSectionDeniedForModule returns false for other sections under fraud", () => {
    const others: NarrativeSectionKey[] = [
      "executiveSummary",
      "transactionOverviewArgument",
      "chronologyArgument",
      "paymentAuthenticationArgument",
      "fulfillmentArgument",
      "communicationArgument",
      "manualEvidenceArgument",
      "conclusion",
    ];
    for (const k of others) {
      expect(isSectionDeniedForModule(k, "visa_10_4_fraud"), k).toBe(false);
    }
  });

  it("isSectionDeniedForModule returns false for policyArgument under non-fraud modules", () => {
    expect(
      isSectionDeniedForModule("policyArgument", "inr_product_not_received"),
    ).toBe(false);
    expect(isSectionDeniedForModule("policyArgument", null)).toBe(false);
    expect(isSectionDeniedForModule("policyArgument", undefined)).toBe(false);
  });

  it("composePdfBlocks drops policyArgument when moduleKey=visa_10_4_fraud, even if LLM emitted text", () => {
    const blocks = composePdfBlocks({
      narrative: narrative({
        policyArgument: section(
          "The merchant's refund, shipping, and cancellation policies were published.",
          ["f0"],
        ),
        conclusion: section("Concl.", ["f0"]),
      }),
      approvedFacts: [fact()],
      packageMode: "full",
      familyKey: "unauthorized_fraud",
      moduleKey: "visa_10_4_fraud",
      fulfillmentStatus: null,
    });
    expect(blocks.find((b) => b.sectionKey === "policyArgument")).toBeUndefined();
    // Other sections still flow through.
    expect(blocks.find((b) => b.sectionKey === "conclusion")).toBeDefined();
  });

  it("composePdfBlocks keeps policyArgument when moduleKey is null or non-fraud", () => {
    const blocks = composePdfBlocks({
      narrative: narrative({
        policyArgument: section("Policies on file.", ["f0"]),
      }),
      approvedFacts: [fact()],
      packageMode: "full",
      familyKey: "unauthorized_fraud",
      moduleKey: null,
      fulfillmentStatus: null,
    });
    expect(blocks.find((b) => b.sectionKey === "policyArgument")).toBeDefined();
  });
});

describe("Invariant 4 — Chronology thesis must not over-promise event categories", () => {
  it("the embedded HTML view does not carry an over-promising thesis literal", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fp = path.resolve(
      process.cwd(),
      "app/(embedded)/app/disputes/[id]/tabs/sections/DefencePackageHtmlView.tsx",
    );
    const src = readFileSync(fp, "utf8");
    // The old static thesis library (which used to over-promise
    // "site engagement, order placement, ...") is gone — the HTML
    // view now consumes the templated thesis from
    // lib/defence/pdf/thesisTemplates.ts via renderThesis().
    expect(src).not.toMatch(/site engagement, order placement/);
    expect(src).not.toMatch(/each step traceable to the cardholder's session/);
    expect(src).not.toMatch(/const VISA_10_4_FRAUD_THESIS:\s*Record</);
    expect(src).not.toMatch(/const GENERIC_THESIS:\s*Record</);
  });

  it("the PDF thesis template for chronologyArgument is the neutral wording", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fp = path.resolve(
      process.cwd(),
      "lib/defence/pdf/thesisTemplates.ts",
    );
    const src = readFileSync(fp, "utf8");
    expect(src).toMatch(
      /timeline of events records the relevant moments of the customer's interaction/,
    );
    expect(src).not.toMatch(/site engagement, order placement/);
  });
});

describe("Invariant 5 — HTML view chronology mirrors the PDF (no parallel synthesis)", () => {
  it("the workspace API surfaces `timelineEvents` on the dispute payload", async () => {
    // Lock in that the workspace API route includes the
    // `timelineEvents` field. Before 2026-05-19 the field was dropped
    // between `deriveOrderContext` and the JSON response, forcing the
    // HTML view's chronology to fall back to the 2-event synthetic
    // path while the PDF rendered the full 8-event Shopify timeline.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fp = path.resolve(
      process.cwd(),
      "app/api/disputes/[id]/workspace/route.ts",
    );
    const src = readFileSync(fp, "utf8");
    expect(src).toMatch(/timelineEvents:\s*orderContext\.timelineEvents/);
  });

  it("the DisputeContextLike type carries timelineEvents and consumes the shared builder", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fp = path.resolve(
      process.cwd(),
      "app/(embedded)/app/disputes/[id]/tabs/sections/DefencePackageHtmlView.tsx",
    );
    const src = readFileSync(fp, "utf8");
    // The DisputeContextLike interface must declare `timelineEvents`.
    expect(src).toMatch(
      /timelineEvents\?:\s*Array<\{\s*at:\s*string;\s*text:\s*string\s*\}>/,
    );
    // The HTML view MUST import the shared chronology builder — no
    // parallel implementation allowed.
    expect(src).toMatch(/buildChronologyEvents/);
    expect(src).toMatch(/from\s+["']@\/lib\/defence\/chronology["']/);
    // And it MUST call the shared builder rather than inlining the
    // priority logic.
    expect(src).toMatch(/buildChronologyEvents\(\s*\{/);
  });

  it("ReviewSubmitTab threads timelineEvents into the HTML view dispute prop", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fp = path.resolve(
      process.cwd(),
      "app/(embedded)/app/disputes/[id]/tabs/ReviewSubmitTab.tsx",
    );
    const src = readFileSync(fp, "utf8");
    expect(src).toMatch(/timelineEvents:\s*data\.dispute\.timelineEvents/);
  });

  it("the PDF renderer also consumes the shared builder (no duplicate logic)", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fp = path.resolve(
      process.cwd(),
      "lib/defence/pdf/DefencePackageDocument.tsx",
    );
    const src = readFileSync(fp, "utf8");
    expect(src).toMatch(/buildChronologyEvents/);
    expect(src).toMatch(/from\s+["']\.\.\/chronology["']/);
    // And the old inline `function chronologyEvents(...)` must be gone.
    expect(src).not.toMatch(/^function chronologyEvents\(/m);
  });
});

describe("Invariant 6 — shared chronology builder behaves correctly on both paths", () => {
  it("returns the rich timeline (sorted) when timelineEvents is non-empty", async () => {
    const { buildChronologyEvents } = await import("../chronology");
    const events = buildChronologyEvents(
      {
        timelineEvents: [
          { at: "2026-05-17T21:44:43Z", text: "C" },
          { at: "2026-05-17T21:44:36Z", text: "A" },
          { at: "2026-05-17T21:44:42Z", text: "B" },
        ],
        transactionDate: "2026-05-17T21:44:36Z",
        orderName: "#1078",
        cardNetwork: "visa",
        cardLast4: "0259",
      },
      [],
    );
    expect(events.map((e) => e.text)).toEqual(["A", "B", "C"]);
  });

  it("falls back to synthetic 2-event path when timelineEvents is empty/null", async () => {
    const { buildChronologyEvents } = await import("../chronology");
    const events = buildChronologyEvents(
      {
        timelineEvents: null,
        transactionDate: "2026-05-17T21:44:36Z",
        orderName: "#1078",
        cardNetwork: "Visa",
        cardLast4: "0259",
      },
      [],
    );
    expect(events.length).toBe(2);
    expect(events[0].text).toMatch(/Order placed.*#1078/);
    expect(events[1].text).toMatch(/Authorisation captured.*Visa ending in 0259/);
  });

  it("rich path takes precedence even when transactionDate is also set", async () => {
    const { buildChronologyEvents } = await import("../chronology");
    const events = buildChronologyEvents(
      {
        timelineEvents: [
          { at: "2026-05-17T22:00:00Z", text: "captured" },
        ],
        transactionDate: "2026-05-17T21:44:36Z",
        orderName: "#1078",
      },
      [],
    );
    // Rich path wins — no synthetic fallback events get appended.
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe("captured");
  });

  it("synthetic fallback adds a customer_communication event when fact carries lastMessageAt", async () => {
    const { buildChronologyEvents } = await import("../chronology");
    const events = buildChronologyEvents(
      {
        timelineEvents: null,
        transactionDate: "2026-05-17T21:44:36Z",
      },
      [
        {
          id: "fc",
          category: "customer_communication",
          label: "x",
          value: {
            lastMessageAt: "2026-05-18T09:00:00Z",
            customerConfirmsOrder: true,
          },
          source: "shopify_order",
          sourceRef: null,
          strength: "supporting",
          bankEligible: true,
          merchantVisible: true,
          internalOnly: false,
          includeInBankNarrative: true,
          submissionRisk: false,
          confidence: null,
        },
      ],
    );
    expect(events.some((e) => /order receipt confirmed/i.test(e.text))).toBe(true);
  });

  it("returns empty array when no inputs at all", async () => {
    const { buildChronologyEvents } = await import("../chronology");
    expect(buildChronologyEvents({}, [])).toEqual([]);
  });
});

/**
 * Invariant 7 — every renderer-shared helper has exactly TWO consumers:
 *   - lib/defence/pdf/DefencePackageDocument.tsx        (PDF renderer)
 *   - app/(embedded)/.../DefencePackageHtmlView.tsx     (embedded HTML view)
 *
 * If either renderer stops importing the shared module, this test
 * fails. That's the structural guarantee against the chronology-class
 * divergence we shipped fixes for: a renderer can't quietly grow its
 * own parallel implementation without breaking the build.
 */
describe("Invariant 7 — both renderers import every shared helper", () => {
  async function readBoth(): Promise<{ pdf: string; html: string }> {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const pdf = readFileSync(
      path.resolve(
        process.cwd(),
        "lib/defence/pdf/DefencePackageDocument.tsx",
      ),
      "utf8",
    );
    const html = readFileSync(
      path.resolve(
        process.cwd(),
        "app/(embedded)/app/disputes/[id]/tabs/sections/DefencePackageHtmlView.tsx",
      ),
      "utf8",
    );
    return { pdf, html };
  }

  it("both renderers import the shared SECTION_ORDER + SECTION_TITLES", async () => {
    const { pdf, html } = await readBoth();
    // PDF gets them transitively through composePdfBlocks — assert
    // there's no local copy in either file. The HTML view imports
    // them directly.
    expect(html).toMatch(/from\s+["']@\/lib\/defence\/render\/sections["']/);
    expect(html).toMatch(/SECTION_ORDER/);
    expect(html).toMatch(/SECTION_TITLES/);
    // Old local declarations must be gone from the HTML view.
    expect(html).not.toMatch(/const SECTION_ORDER:\s*NarrativeSectionKey\[\]/);
    expect(html).not.toMatch(/const SECTION_TITLES:\s*Record</);
    // The PDF pipeline reads them via composePdfBlocks.
    const compose = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(
        process.cwd(),
        "lib/defence/pdf/composePdfBlocks.ts",
      ),
      "utf8",
    );
    expect(compose).toMatch(
      /from\s+["']\.\.\/render\/sections["']/,
    );
    void pdf;
  });

  it("both renderers consume the shared evidence-basis row builder", async () => {
    const { html } = await readBoth();
    expect(html).toMatch(/buildEvidenceBasisRows/);
    expect(html).toMatch(
      /from\s+["']@\/lib\/defence\/pdf\/evidenceBasisRows["']/,
    );
    // The old local renderFactValue is gone — the formatter is
    // owned by evidenceBasisRows.ts.
    expect(html).not.toMatch(/^function renderFactValue\(/m);
    expect(html).not.toMatch(/^function buildEvidenceBasis\(/m);
  });

  it("both renderers consume the shared thesis system (renderThesis)", async () => {
    const { html } = await readBoth();
    expect(html).toMatch(/renderThesis/);
    expect(html).toMatch(/from\s+["']@\/lib\/defence\/pdf\/renderThesis["']/);
    // Old static thesis libraries are gone.
    expect(html).not.toMatch(/const GENERIC_THESIS:\s*Record</);
    expect(html).not.toMatch(/const VISA_10_4_FRAUD_THESIS:\s*Record</);
  });

  it("both renderers consume the shared Case Details row builder", async () => {
    const { pdf, html } = await readBoth();
    expect(pdf).toMatch(/buildCaseDetailsRows/);
    expect(pdf).toMatch(
      /from\s+["']\.\.\/render\/caseDetails["']/,
    );
    expect(html).toMatch(/buildCaseDetailsRows/);
    expect(html).toMatch(
      /from\s+["']@\/lib\/defence\/render\/caseDetails["']/,
    );
  });

  it("both renderers consume the shared Line Items builder", async () => {
    const { pdf, html } = await readBoth();
    expect(pdf).toMatch(/buildLineItems/);
    expect(pdf).toMatch(/from\s+["']\.\.\/render\/lineItems["']/);
    expect(html).toMatch(/buildLineItems/);
    expect(html).toMatch(/from\s+["']@\/lib\/defence\/render\/lineItems["']/);
    // No local `lineItemsFromFacts` in the PDF.
    expect(pdf).not.toMatch(/^function lineItemsFromFacts\(/m);
  });

  it("both renderers consume the shared chronology builder", async () => {
    const { pdf, html } = await readBoth();
    expect(pdf).toMatch(/buildChronologyEvents/);
    expect(pdf).toMatch(/from\s+["']\.\.\/chronology["']/);
    expect(html).toMatch(/buildChronologyEvents/);
    expect(html).toMatch(/from\s+["']@\/lib\/defence\/chronology["']/);
  });
});

/**
 * Invariant 8 — Evidence Basis rows must never echo raw AVS/CVV
 * gateway codes or the raw Shopify fulfillmentStatus. Same rule the
 * LLM narrative obeys; applies to both renderers because they read
 * the same row data from evidenceBasisRows.ts.
 */
describe("Invariant 8 — Evidence Basis never echoes raw gateway codes or fulfillmentStatus", () => {
  it("payment_authentication fact translates AVS/CVV to plain language", async () => {
    const { buildEvidenceBasisRows } = await import(
      "../pdf/evidenceBasisRows"
    );
    const rows = buildEvidenceBasisRows([
      {
        id: "f8",
        category: "payment_authentication",
        label: "Payment authentication",
        value: {
          avsResult: "Y",
          cvvResult: "M",
          verificationSummary:
            "the billing address matched the issuer's records and the card verification code matched the issuer's records",
        },
        source: "shopify_order",
        sourceRef: null,
        strength: "strong",
        bankEligible: true,
        merchantVisible: true,
        internalOnly: false,
        includeInBankNarrative: true,
        submissionRisk: false,
        confidence: null,
      },
    ]);
    expect(rows[0].value).not.toMatch(/\bAVS [YN]\b/);
    expect(rows[0].value).not.toMatch(/\bCVV [MN]\b/);
    expect(rows[0].value).toMatch(/billing address matched/i);
  });

  it("order_record fact never echoes UNFULFILLED/FULFILLED in the value column", async () => {
    const { buildEvidenceBasisRows } = await import(
      "../pdf/evidenceBasisRows"
    );
    const rowsUnfulfilled = buildEvidenceBasisRows([
      {
        id: "f0",
        category: "order_record",
        label: "Order record",
        value: { fulfillmentStatus: "UNFULFILLED" },
        source: "shopify_order",
        sourceRef: null,
        strength: "supporting",
        bankEligible: true,
        merchantVisible: true,
        internalOnly: false,
        includeInBankNarrative: true,
        submissionRisk: false,
        confidence: null,
      },
    ]);
    expect(rowsUnfulfilled[0].value).toBe("Order on record");
    expect(rowsUnfulfilled[0].value).not.toMatch(/UNFULFILLED/);

    const rowsFulfilled = buildEvidenceBasisRows([
      {
        id: "f0",
        category: "order_record",
        label: "Order record",
        value: { fulfillmentStatus: "FULFILLED" },
        source: "shopify_order",
        sourceRef: null,
        strength: "supporting",
        bankEligible: true,
        merchantVisible: true,
        internalOnly: false,
        includeInBankNarrative: true,
        submissionRisk: false,
        confidence: null,
      },
    ]);
    expect(rowsFulfilled[0].value).toBe("Order on record");
    expect(rowsFulfilled[0].value).not.toMatch(/FULFILLED/);
  });
});

/**
 * Invariant 9 — Case Details cover table per-family row deny list.
 *
 * `Fulfillment status: UNFULFILLED` on the bank-facing cover table is
 * a self-inflicted weakness for a Visa 10.4 fraud rebuttal — the
 * issuer reads it and asks "if you didn't ship it, what is there to
 * refute?" The fraud argument hinges on cardholder authentication,
 * not delivery. The row is suppressed for the `unauthorized_fraud`
 * family. Other families keep every row because fulfillment IS the
 * argument there (INR proves it shipped; product-not-as-described
 * proves it arrived).
 */
describe("Invariant 9 — Case Details deny list by reason family", () => {
  it("drops Fulfillment status row for unauthorized_fraud family", async () => {
    const { buildCaseDetailsRows } = await import("../render/caseDetails");
    const rows = buildCaseDetailsRows({
      disputeIdShort: "abc123",
      merchantName: "Test Shop",
      cardNetwork: "Visa",
      transactionDateDisplay: "2026-05-17",
      amountDisplay: "USD 432.90",
      reasonCodeDisplay: "Visa 10.4",
      orderName: "#1078",
      fulfillmentStatus: "UNFULFILLED",
      familyKey: "unauthorized_fraud",
    });
    const labels = rows.map(([label]) => label);
    expect(labels).not.toContain("Fulfillment status");
    // Other rows still present.
    expect(labels).toContain("Dispute ID");
    expect(labels).toContain("Merchant name");
    expect(labels).toContain("Reason code");
  });

  it("keeps Fulfillment status row for item_not_received family", async () => {
    const { buildCaseDetailsRows } = await import("../render/caseDetails");
    const rows = buildCaseDetailsRows({
      orderName: "#1078",
      fulfillmentStatus: "FULFILLED",
      familyKey: "item_not_received",
    });
    const labels = rows.map(([label]) => label);
    expect(labels).toContain("Fulfillment status");
    // The value renders as-is — INR cases NEED to show fulfilment.
    const fulfillmentRow = rows.find(
      ([label]) => label === "Fulfillment status",
    );
    expect(fulfillmentRow?.[1]).toBe("FULFILLED");
  });

  it("keeps every row when familyKey is null (legacy behaviour)", async () => {
    const { buildCaseDetailsRows } = await import("../render/caseDetails");
    const rows = buildCaseDetailsRows({
      fulfillmentStatus: "UNFULFILLED",
      familyKey: null,
    });
    const labels = rows.map(([label]) => label);
    expect(labels).toContain("Fulfillment status");
  });
});
