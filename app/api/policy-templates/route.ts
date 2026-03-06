import { NextResponse } from "next/server";

const TEMPLATES = [
  {
    type: "refunds",
    name: "Refund Policy",
    description: "Standard return and refund terms for dispute evidence.",
  },
  {
    type: "shipping",
    name: "Shipping Policy",
    description: "Shipping timelines, carriers, and delivery terms.",
  },
  {
    type: "terms",
    name: "Terms of Service",
    description: "Payment terms, cancellations, and dispute procedures.",
  },
] as const;

/**
 * GET /api/policy-templates
 * Returns metadata for the suggested policy templates.
 */
export async function GET() {
  return NextResponse.json({ templates: TEMPLATES });
}
