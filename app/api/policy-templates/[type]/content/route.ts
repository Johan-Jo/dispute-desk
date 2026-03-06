import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

const VALID_TYPES = ["refunds", "shipping", "terms"] as const;
const FILE_MAP: Record<(typeof VALID_TYPES)[number], string> = {
  refunds: "refund-policy.md",
  shipping: "shipping-policy.md",
  terms: "terms-of-service.md",
};

/**
 * GET /api/policy-templates/[type]/content
 * Returns the Markdown body for the given policy template type.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const { type } = await params;
  if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    return NextResponse.json({ error: "Invalid template type" }, { status: 400 });
  }

  const filename = FILE_MAP[type as (typeof VALID_TYPES)[number]];
  const path = join(process.cwd(), "content", "policy-templates", filename);

  try {
    const body = await readFile(path, "utf-8");
    return NextResponse.json({ body });
  } catch (err) {
    console.error("[policy-templates/content]", err);
    return NextResponse.json(
      { error: "Template not found" },
      { status: 404 }
    );
  }
}
