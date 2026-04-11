import { NextRequest, NextResponse } from "next/server";

/**
 * Parse an API route's JSON body while distinguishing three cases:
 *
 *   1. Empty body (Content-Length 0, or no body at all)   → returns {}
 *      so routes with optional-body semantics keep working.
 *
 *   2. Non-empty body, valid JSON                         → returns parsed.
 *
 *   3. Non-empty body, malformed JSON                     → returns a
 *      400 NextResponse the caller can return directly.
 *
 * Before this helper, several routes wrapped `req.json()` in
 * `.catch(() => ({}))`, which silently turned malformed JSON into an
 * empty object — downstream code then saw missing fields and either
 * 404'd or crashed with confusing messages. This helper keeps the
 * "optional body" convenience while surfacing genuine parse failures
 * as 400s.
 *
 * Usage:
 *
 *   const parsed = await parseJsonBody<{ shop_id?: string }>(req);
 *   if (parsed instanceof NextResponse) return parsed;
 *   const { shop_id } = parsed;
 */
export async function parseJsonBody<T = Record<string, unknown>>(
  req: NextRequest,
): Promise<T | NextResponse> {
  const raw = await req.text();
  if (!raw || raw.trim().length === 0) {
    return {} as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid JSON body",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }
}
