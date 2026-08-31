/**
 * POST /api/admin/outcome-analysis/[id]/review
 *
 * Append a review to a post-outcome analysis. Admin-only.
 *
 * Reviews are append-only (plan §11, §17): this route never updates or deletes,
 * so a reviewer who changes their mind adds a decision rather than replacing
 * one. The authorisation check runs twice on purpose — `hasAdminSession` here,
 * and `assertReviewer` inside `appendReview` against the same
 * `internal_admin_grants` row. The second is not redundant: a review is what
 * promotes a hypothesis into something allowed to drive a rule change, and that
 * check belongs next to the write rather than resting on every future caller
 * remembering it.
 */

import { NextResponse } from "next/server";
import { getAdminSessionUser, hasAdminSession } from "@/lib/admin/auth";
import {
  appendReview,
  ReviewAuthorizationError,
  ReviewValidationError,
} from "@/lib/postOutcome/reviews";
import {
  isConfidenceLevel,
  isFindingCategory,
  isReviewDisposition,
} from "@/lib/postOutcome/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await getAdminSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const disposition = body.disposition;
  if (typeof disposition !== "string" || !isReviewDisposition(disposition)) {
    return NextResponse.json(
      { error: "disposition must be CONFIRMED, EDITED, REJECTED or INDETERMINATE" },
      { status: 400 },
    );
  }

  const categoryOverride =
    typeof body.categoryOverride === "string" && isFindingCategory(body.categoryOverride)
      ? body.categoryOverride
      : null;
  const confidenceOverride =
    typeof body.confidenceOverride === "string" && isConfidenceLevel(body.confidenceOverride)
      ? body.confidenceOverride
      : null;
  const notes = typeof body.notes === "string" ? body.notes : null;

  try {
    const review = await appendReview({
      analysisId: id,
      reviewerUserId: user.id,
      disposition,
      categoryOverride,
      confidenceOverride,
      notes,
    });
    return NextResponse.json({ review });
  } catch (error) {
    if (error instanceof ReviewValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ReviewAuthorizationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Review failed" },
      { status: 500 },
    );
  }
}
