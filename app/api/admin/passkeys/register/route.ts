import { NextRequest, NextResponse } from "next/server";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";
import {
  CLIENT_DEVICE_HINTS,
  getRpConfig,
  listPasskeys,
  savePasskey,
} from "@/lib/admin/passkeys";
import {
  WEBAUTHN_CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
  passkeyCookieOptions,
  signChallenge,
  verifyChallengeValue,
} from "@/lib/admin/passkeyCookie";

export const runtime = "nodejs";

/**
 * POST /api/admin/passkeys/register — issue a WebAuthn registration challenge.
 *
 * Grant-gated by middleware (this route is allow-listed at session+grant so an
 * admin without a passkey can enroll). Stores the challenge in a short-TTL signed
 * cookie; never trusts a client-sent challenge.
 */
export async function POST(req: NextRequest) {
  const admin = (await hasAdminSession()) ? await getAdminSessionUser() : null;
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { rpID, rpName } = getRpConfig(req);
  const existing = await listPasskeys(admin.id);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: admin.email,
    userDisplayName: admin.name ?? admin.email,
    attestationType: "none",
    // Don't let the same authenticator register twice.
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: (c.transports ?? undefined) as
        | RegistrationResponseJSON["response"]["transports"]
        | undefined,
    })),
    authenticatorSelection: {
      // Bind admin access to the built-in authenticator of the machine being
      // enrolled (Windows Hello / Touch ID / Face ID). Without this, Chrome
      // also offers its cross-device "use a phone" flow, so the admin sees two
      // competing prompts instead of one device unlock.
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required", // force the biometric / device unlock
    },
  });

  // Same on-device-only hint as the auth ceremony, so enrolling doesn't offer
  // the phone / Google route either. Pairs with authenticatorAttachment:
  // "platform" above — that constrains WHAT may enrol, this constrains the UI.
  const res = NextResponse.json({ ...options, hints: CLIENT_DEVICE_HINTS });
  res.cookies.set(
    WEBAUTHN_CHALLENGE_COOKIE,
    await signChallenge({
      userId: admin.id,
      challenge: options.challenge,
      kind: "reg",
      iat: Math.floor(Date.now() / 1000),
    }),
    passkeyCookieOptions(CHALLENGE_TTL_SECONDS),
  );
  return res;
}

/**
 * PUT /api/admin/passkeys/register — verify the attestation + store the credential.
 * On success the admin has a passkey; they still complete an auth ceremony
 * (`/api/admin/passkeys/authenticate`) to get the verified-session cookie. The
 * enroll page chains straight into verify.
 */
export async function PUT(req: NextRequest) {
  const admin = (await hasAdminSession()) ? await getAdminSessionUser() : null;
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const challenge = await verifyChallengeValue(
    req.cookies.get(WEBAUTHN_CHALLENGE_COOKIE)?.value,
  );
  if (!challenge || challenge.kind !== "reg" || challenge.userId !== admin.id) {
    return NextResponse.json(
      { error: "Challenge expired or invalid. Try again.", code: "CHALLENGE_INVALID" },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    response?: RegistrationResponseJSON;
    friendlyName?: string;
  } | null;
  if (!body?.response) {
    return NextResponse.json({ error: "Missing registration response" }, { status: 400 });
  }

  const { rpID, origin } = getRpConfig(req);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed" },
      { status: 400 },
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Registration not verified" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  await savePasskey({
    userId: admin.id,
    credentialId: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports ?? null,
    friendlyName:
      typeof body.friendlyName === "string" && body.friendlyName.trim()
        ? body.friendlyName.trim().slice(0, 80)
        : null,
  });

  const res = NextResponse.json({ ok: true });
  // Clear the single-use challenge cookie.
  res.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, "", passkeyCookieOptions(0));
  return res;
}
