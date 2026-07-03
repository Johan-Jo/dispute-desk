/**
 * Read-only enforcement for SuperAdmin impersonation.
 *
 * The middleware already blocks the common case: any non-GET `/api/*` request
 * made while impersonating in READ mode is rejected with 403 before the route
 * runs (see `middleware.ts`, embedded-API block). This guard is the belt for
 * the rare mutating-GET route — call it at the top of any GET handler that
 * writes state.
 *
 * Resolution reads the `x-dd-impersonation-mode` header, which the middleware
 * sets ONLY when a valid impersonation cookie is present. A normal merchant
 * session never carries it, so this is a no-op outside impersonation.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { IMPERSONATION_MODE_HEADER } from "@/lib/admin/impersonation";

/**
 * Returns a 403 response when the request is an impersonation session in READ
 * mode, or `null` when the write should proceed (not impersonating, or WRITE
 * mode). Usage:
 *
 *   const blocked = assertImpersonationWriteAllowed(req);
 *   if (blocked) return blocked;
 */
export function assertImpersonationWriteAllowed(
  req: NextRequest,
): NextResponse | null {
  const mode = req.headers.get(IMPERSONATION_MODE_HEADER);
  if (mode === "read") {
    return NextResponse.json(
      {
        error:
          "This is a read-only admin preview. Enable write mode to make changes.",
        code: "IMPERSONATION_READ_ONLY",
      },
      { status: 403 },
    );
  }
  return null;
}
