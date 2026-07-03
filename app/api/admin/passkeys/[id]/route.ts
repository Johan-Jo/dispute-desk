import { NextRequest, NextResponse } from "next/server";
import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";
import {
  countPasskeys,
  renamePasskey,
  revokePasskey,
} from "@/lib/admin/passkeys";
import { verifyPasskeyCookie } from "@/lib/admin/passkeyCookie";

export const runtime = "nodejs";

async function requireVerifiedAdmin(req: NextRequest) {
  const admin = (await hasAdminSession()) ? await getAdminSessionUser() : null;
  if (!admin) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const passkey = await verifyPasskeyCookie(req);
  if (!passkey || passkey.userId !== admin.id) {
    return {
      error: NextResponse.json(
        { error: "Passkey verification required", code: "ADMIN_PASSKEY_REQUIRED" },
        { status: 403 },
      ),
    };
  }
  return { admin };
}

type RouteParams = { params: Promise<{ id: string }> };

/** PATCH /api/admin/passkeys/[id] — rename a passkey (friendly name). */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const gate = await requireVerifiedAdmin(req);
  if (gate.error) return gate.error;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { friendlyName?: unknown } | null;
  const friendlyName =
    typeof body?.friendlyName === "string" ? body.friendlyName.trim() : "";
  if (!friendlyName) {
    return NextResponse.json({ error: "friendlyName is required" }, { status: 400 });
  }

  const ok = await renamePasskey(gate.admin.id, id, friendlyName);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/passkeys/[id] — revoke a passkey.
 *
 * Lock-out guard: refuse to delete the caller's LAST passkey — otherwise the
 * next /admin visit would bounce to enroll with no way in except the SQL escape
 * hatch. Removing a lost device is fine as long as one remains; to remove them
 * all, the operator uses the documented service-role DELETE.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const gate = await requireVerifiedAdmin(req);
  if (gate.error) return gate.error;
  const { id } = await params;

  const total = await countPasskeys(gate.admin.id);
  if (total <= 1) {
    return NextResponse.json(
      {
        error:
          "This is your only passkey. Add another device before removing this one.",
        code: "LAST_PASSKEY",
      },
      { status: 409 },
    );
  }

  const ok = await revokePasskey(gate.admin.id, id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
