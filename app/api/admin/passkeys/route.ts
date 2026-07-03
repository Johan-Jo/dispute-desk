import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";
import { listPasskeySummaries } from "@/lib/admin/passkeys";
import { verifyPasskeyCookie } from "@/lib/admin/passkeyCookie";

export const runtime = "nodejs";

/**
 * GET /api/admin/passkeys — list the caller's registered passkeys (metadata
 * only; no key material). Unlike the ceremony routes, managing devices REQUIRES
 * a passkey-verified session — you must already hold a passkey to see/manage the
 * list. The middleware allow-lists /api/admin/passkeys/* at session+grant (so an
 * unverified admin can enroll/verify), so we enforce the passkey factor here in
 * the handler for the management surface.
 */
export async function GET(req: NextRequest) {
  const admin = (await hasAdminSession()) ? await getAdminSessionUser() : null;
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const passkey = await verifyPasskeyCookie(req);
  if (!passkey || passkey.userId !== admin.id) {
    return NextResponse.json(
      { error: "Passkey verification required", code: "ADMIN_PASSKEY_REQUIRED" },
      { status: 403 },
    );
  }

  const passkeys = await listPasskeySummaries(admin.id);
  // Flag which credential satisfied the current session so the UI can label it.
  return NextResponse.json({
    passkeys,
    currentCredentialId: passkey.credentialId,
  });
}
