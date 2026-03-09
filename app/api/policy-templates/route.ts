import { NextResponse } from "next/server";
import {
  POLICY_LIBRARY,
  POLICY_LIBRARY_ORDER,
  type PolicyTemplateType,
} from "@/lib/policy-templates/library";

/**
 * GET /api/policy-templates
 * Returns the Policy Library: metadata for all recommended store policy templates.
 */
export async function GET() {
  const templates = POLICY_LIBRARY_ORDER.map((type) => {
    const meta = POLICY_LIBRARY.find((t) => t.type === type);
    if (!meta) return null;
    return {
      type: meta.type as PolicyTemplateType,
      id: meta.id,
      name: meta.title,
      description: meta.shortDescription,
      bestFor: meta.bestFor,
      categoryTags: meta.categoryTags,
      qualityBadge: meta.qualityBadge,
      merchantPlaceholders: meta.merchantPlaceholders,
      merchantNotes: meta.merchantNotes,
      disputeDefenseValue: meta.disputeDefenseValue,
    };
  }).filter(Boolean);

  return NextResponse.json({
    templates,
    packTitle: "Essential Store Policy Pack",
    packSubtitle:
      "A publish-ready starter pack for ecommerce stores selling physical goods.",
  });
}
