/**
 * GET /api/health/build
 *
 * Build/deploy identification probe. Returns the commit SHA, the Vercel
 * deployment ID, and the build timestamp so an external monitor (or a
 * developer with curl) can verify exactly which build is serving a
 * given request.
 *
 * Why this exists: during a debugging session it's often unclear
 * whether a fix has actually been rolled out yet. Hitting this endpoint
 * answers "is the new code live?" without guessing.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Never cache — the whole point is to see WHICH build is serving the
// request right now.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    commitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    deploymentUrl: process.env.VERCEL_URL ?? null,
    environment: process.env.VERCEL_ENV ?? null,
    builtAt: process.env.BUILD_TIMESTAMP ?? null,
    nodeVersion: process.version,
  });
}
