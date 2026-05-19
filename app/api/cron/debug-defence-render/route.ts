/**
 * GET /api/debug/defence-render?secret=...
 *
 * Synchronous PDF-render smoke test. Renders a literal hello-world PDF
 * inside the same prod runtime that buildDefencePackageJob uses. Returns
 * JSON with success + buffer size, OR error + stack.
 *
 * REMOVE ONCE THE PROD RENDER BUG IS UNDERSTOOD.
 */
import { NextRequest, NextResponse } from "next/server";
import React from "react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const secret =
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    req.nextUrl.searchParams.get("secret");
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ?full=1 exercises the production renderDefencePdf path against a
  // synthetic data set — same code path the buildDefencePackageJob uses.
  // Default (no param) renders a minimal hello-world to isolate bundler
  // problems from document-tree problems.
  const wantsFull = req.nextUrl.searchParams.get("full") === "1";

  try {
    if (wantsFull) {
      const { renderDefencePdf } = await import("@/lib/defence/renderDefencePdf");
      const { composePdfBlocks } = await import("@/lib/defence/pdf/composePdfBlocks");
      const debugFacts = [
        {
          id: "f0",
          category: "payment_authentication" as const,
          label: "AVS+CVV match",
          value: { avsResult: "Y", cvvResult: "M" },
          source: "shopify_order",
          sourceRef: null,
          strength: "strong" as const,
          bankEligible: true,
          merchantVisible: true,
          internalOnly: false,
          includeInBankNarrative: true,
          submissionRisk: false,
          confidence: null,
        },
      ];
      const debugNarrative = {
        executiveSummary: { text: "Debug summary.", usedFactIds: ["f0"] },
        transactionOverviewArgument: { text: "Debug overview.", usedFactIds: ["f0"] },
        chronologyArgument: { text: "Debug chronology.", usedFactIds: ["f0"] },
        paymentAuthenticationArgument: { text: "Debug auth.", usedFactIds: ["f0"] },
        fulfillmentArgument: { text: "", usedFactIds: [] },
        communicationArgument: { text: "", usedFactIds: [] },
        policyArgument: { text: "", usedFactIds: [] },
        manualEvidenceArgument: { text: "", usedFactIds: [] },
        conclusion: { text: "Debug conclusion.", usedFactIds: ["f0"] },
        omittedSections: [
          { sectionKey: "fulfillmentArgument" as const, reason: "debug" },
          { sectionKey: "communicationArgument" as const, reason: "debug" },
          { sectionKey: "policyArgument" as const, reason: "debug" },
          { sectionKey: "manualEvidenceArgument" as const, reason: "debug" },
        ],
        warnings: [],
      };
      const buffer = (
        await renderDefencePdf({
          meta: {
            packageId: "debug-full-test",
            disputeGid: "gid://shopify/Dispute/0",
            orderName: "#TEST",
            reasonCode: "10.4",
            reasonCodeDisplay: "Visa 10.4 / Mastercard 4837",
            claimType: "Unauthorized transaction claim",
            reasonCodeModuleKey: "visa_10_4_fraud",
            shopName: "Debug Shop",
            merchantName: "Debug Shop",
            amountDisplay: "USD 25.93",
            cardNetwork: "Visa",
            cardLast4: "0259",
            paymentGateway: "Shopify Payments",
            financialStatus: "PAID",
            fulfillmentStatus: "UNFULFILLED",
            cardholderName: "Test Cardholder",
            customerEmail: null,
            transactionDate: "2026-05-15T13:10:14Z",
            generatedAt: new Date().toISOString(),
            version: 1,
            packageMode: "full",
            promptFamily: "defence_package_narrative",
            promptVersion: 2,
            modelUsed: "claude-sonnet-4-6",
            evidenceHash: "debug",
            generatedBy: "system",
          },
          composedBlocks: composePdfBlocks({
            narrative: debugNarrative,
            approvedFacts: debugFacts,
            packageMode: "full",
            familyKey: "unauthorized_fraud",
            moduleKey: "visa_10_4_fraud",
            fulfillmentStatus: "UNFULFILLED",
          }),
          approvedFacts: debugFacts,
          manualEvidence: [],
        })
      ).buffer;
      return NextResponse.json({
        ok: true,
        path: "renderDefencePdf",
        size: buffer.length,
        magic: buffer.slice(0, 5).toString(),
      });
    }

    const reactPdf = await import("@react-pdf/renderer");
    const { Document, Page, Text, renderToBuffer } = reactPdf;

    const element = React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4" },
        React.createElement(Text, null, "Hello world from prod"),
      ),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(element as any);
    return NextResponse.json({
      ok: true,
      path: "hello-world",
      size: Buffer.from(buffer).length,
      magic: Buffer.from(buffer).slice(0, 5).toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.slice(0, 4000) : "";
    return NextResponse.json({ ok: false, error: message, stack }, { status: 500 });
  }
}
