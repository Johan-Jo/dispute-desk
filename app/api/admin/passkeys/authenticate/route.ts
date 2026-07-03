import { NextRequest, NextResponse } from "next/server";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { hasAdminSession, getAdminSessionUser } from "@/lib/admin/auth";
import {
  getRpConfig,
  listPasskeys,
  getPasskeyByCredentialId,
  updatePasskeyCounter,
} from "@/lib/admin/passkeys";
import {
  PASSKEY_COOKIE,
  PASSKEY_TTL_SECONDS,
  WEBAUTHN_CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
  passkeyCookieOptions,
  signChallenge,
  signPasskeyVerified,
  verifyChallengeValue,
} from "@/lib/admin/passkeyCookie";

export const runtime = "nodejs";

/**
 * POST /api/admin/passkeys/authenticate — issue a WebAuthn assertion challenge.
 *
 * Grant-gated by middleware (allow-listed at session+grant — this is how an
 * enrolled admin gets a verified session). Scopes allowCredentials to this
 * admin's own passkeys.
 */
export async function POST(req: NextRequest) {
  const admin = (await hasAdminSession()) ? await getAdminSessionUser() : null;
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { rpID } = getRpConfig(req);
  const creds = await listPasskeys(admin.id);
  if (creds.length === 0) {
    return NextResponse.json(
      { error: "No passkey registered", code: "NO_PASSKEY" },
      { status: 400 },
    );
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: (c.transports ?? undefined) as
        | AuthenticatorTransportFuture[]
        | undefined,
    })),
  });

  const res = NextResponse.json(options);
  res.cookies.set(
    WEBAUTHN_CHALLENGE_COOKIE,
    await signChallenge({
      userId: admin.id,
      challenge: options.challenge,
      kind: "auth",
      iat: Math.floor(Date.now() / 1000),
    }),
    passkeyCookieOptions(CHALLENGE_TTL_SECONDS),
  );
  return res;
}

/**
 * PUT /api/admin/passkeys/authenticate — verify the assertion + mint the
 * passkey-verified session cookie the middleware admin gates require.
 */
export async function PUT(req: NextRequest) {
  const admin = (await hasAdminSession()) ? await getAdminSessionUser() : null;
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const challenge = await verifyChallengeValue(
    req.cookies.get(WEBAUTHN_CHALLENGE_COOKIE)?.value,
  );
  if (!challenge || challenge.kind !== "auth" || challenge.userId !== admin.id) {
    return NextResponse.json(
      { error: "Challenge expired or invalid. Try again.", code: "CHALLENGE_INVALID" },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    response?: AuthenticationResponseJSON;
  } | null;
  if (!body?.response) {
    return NextResponse.json({ error: "Missing authentication response" }, { status: 400 });
  }

  // Look up the credential the browser asserted with. Bind it to THIS admin —
  // a credential belonging to another user must never satisfy this session.
  const stored = await getPasskeyByCredentialId(body.response.id);
  if (!stored || stored.userId !== admin.id) {
    return NextResponse.json({ error: "Unknown credential" }, { status: 400 });
  }

  const { rpID, origin } = getRpConfig(req);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: Uint8Array.from(stored.publicKey),
        counter: stored.counter,
        transports: (stored.transports ?? undefined) as
          | AuthenticatorTransportFuture[]
          | undefined,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Verification failed" },
      { status: 400 },
    );
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "Authentication not verified" }, { status: 400 });
  }

  // Clone-detection: persist the new signature counter.
  await updatePasskeyCounter(
    stored.credentialId,
    verification.authenticationInfo.newCounter,
  );

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    PASSKEY_COOKIE,
    await signPasskeyVerified({
      userId: admin.id,
      credentialId: stored.credentialId,
      iat: Math.floor(Date.now() / 1000),
    }),
    passkeyCookieOptions(PASSKEY_TTL_SECONDS),
  );
  // Clear the single-use challenge cookie.
  res.cookies.set(WEBAUTHN_CHALLENGE_COOKIE, "", passkeyCookieOptions(0));
  return res;
}
