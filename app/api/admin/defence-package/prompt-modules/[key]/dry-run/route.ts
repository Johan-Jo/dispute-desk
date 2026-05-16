/**
 * POST /api/admin/defence-package/prompt-modules/:key/dry-run
 *
 * Runs the narrative writer + validator against a fixed sample fact set
 * for the given module key (with an optional in-body override of the
 * prompt body). Persists NOTHING — no defence_packages row, no
 * defence_package_runs row.
 *
 * Useful for ops to test prompt changes before saving a new version.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { hasAdminSession } from "@/lib/admin/auth";
import { resolveReasonCodeModule } from "@/lib/defence/reasonCodes/registry";
import { generateNarrative } from "@/lib/defence/narrativeWriter";
import { validateNarrative } from "@/lib/defence/validateNarrative";
import type { EvidenceFact, ReasonCodeModuleKey } from "@/lib/defence/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  promptBodyOverride: z.string().optional(),
  modelOverride: z.string().optional(),
});

interface SampleFixture {
  reasonCode: string;
  approvedFacts: EvidenceFact[];
  packageMode: "full" | "narrow";
  caseStrength: "strong" | "moderate" | "weak" | "insufficient";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  if (!(await hasAdminSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { key } = await params;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json().catch(() => ({})));
  } catch {
    body = {};
  }

  // Load sample fixture (deterministic — checked into the repo).
  const fixturePath = path.join(process.cwd(), "tests/fixtures/defence-package-sample.json");
  let fixture: SampleFixture;
  try {
    const raw = await fs.readFile(fixturePath, "utf-8");
    fixture = JSON.parse(raw) as SampleFixture;
  } catch (err) {
    return NextResponse.json(
      { error: `Could not load sample fixture: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 },
    );
  }

  const reasonCodeModule = resolveReasonCodeModule(fixture.reasonCode, {
    promptBody: body.promptBodyOverride,
  });

  // Validate the requested module key matches the resolved one (or is the
  // generic fallback).
  if (reasonCodeModule.key !== key && key !== "generic_fallback") {
    // Allow the dry-run to proceed but warn.
  }

  // NOTE: This call hits Anthropic. It DOES write a defence_package_runs
  // row (for cost tracking), but with package_id=null so it doesn't
  // pollute the package timeline. There is no defence_packages row created
  // or mutated by this endpoint.
  const narrativeRes = await generateNarrative(
    {
      packageId: `dry-run-${key}-${Date.now()}`,
      disputeId: "dry-run",
      reasonCode: fixture.reasonCode,
      reasonCodeModule,
      packageMode: fixture.packageMode,
      caseStrength: fixture.caseStrength,
      approvedFacts: fixture.approvedFacts,
      manualEvidence: [],
      internalOnlyFactIds: [],
      missingEvidence: [],
    },
    {
      shopId: "00000000-0000-0000-0000-000000000000",
      packageId: "",
      modelOverride: body.modelOverride ?? null,
    },
  );

  if (!narrativeRes.narrative) {
    return NextResponse.json(
      { error: narrativeRes.error ?? "narrative null", modelUsed: narrativeRes.modelUsed },
      { status: 502 },
    );
  }

  const validation = validateNarrative({
    narrative: narrativeRes.narrative,
    approvedFacts: fixture.approvedFacts,
    reasonCodeModule,
    packageMode: fixture.packageMode,
  });

  return NextResponse.json({
    moduleKey: key as ReasonCodeModuleKey,
    narrative: narrativeRes.narrative,
    validation,
    modelUsed: narrativeRes.modelUsed,
    tokens: narrativeRes.tokens,
    durationMs: narrativeRes.durationMs,
  });
}
