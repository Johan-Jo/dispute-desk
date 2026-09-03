import { NextRequest, NextResponse } from "next/server";
import {
  getShopSettings,
  updateShopSettings,
} from "@/lib/automation/settings";
import {
  extractShopId,
  extractShopIdFromBody,
} from "@/lib/middleware/extractShopId";
import { logAuditEvent } from "@/lib/audit/logEvent";
import { scheduleBlockedBuildReplay } from "@/lib/billing/replayBlockedBuilds";
import { verifyImpersonation } from "@/lib/admin/impersonation";

/**
 * GET /api/automation/settings?shop_id=...
 * Returns automation settings for a shop.
 */
export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json(
      { error: "shop_id required" },
      { status: 400 }
    );
  }

  try {
    const settings = await getShopSettings(shopId);
    return NextResponse.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/automation/settings
 * Body: { shop_id, ...fields }
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { shop_id: _ignore, ...updates } = body;
  const shop_id = extractShopIdFromBody(req, body);

  if (!shop_id) {
    return NextResponse.json(
      { error: "shop_id required" },
      { status: 400 }
    );
  }

  // `auto_save_enabled` is deliberately NOT writable here.
  //
  // It is a mirror of the store-wide switch, owned by
  // `writeStoreAutomation` (see lib/rules/storeAutomation.ts — "DO NOT add a
  // second surface that writes either of these"). Until 2026-07-28 this route
  // accepted it and the /app/settings page rendered a checkbox bound to it, so
  // a merchant could set the flag false while /app/rules still displayed
  // "Auto-pilot" — the switch said automate, the gate silently blocked every
  // save. Two controls, one field, no way to tell which one won.
  //
  // Change the store-wide mode through PUT /api/automation/store instead.
  // `tests/unit/singleAutoSaveWriter.test.ts` fails the build if this comes
  // back.
  const allowed = [
    "auto_build_enabled",
    "auto_save_min_score",
    "enforce_no_blockers",
  ];
  const filtered = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );

  try {
    // Read BEFORE writing so the audit event records the actual transition,
    // not just the new value. `shop_settings.updated_at` covers the whole
    // row, so without a before/after diff there is no way to tell which
    // field a given change touched.
    const before = await getShopSettings(shop_id);
    const settings = await updateShopSettings(shop_id, filtered);

    // Who did it. An admin using "View as merchant" and the merchant
    // themselves both arrive here as an ordinary embedded request; the
    // impersonation cookie is the only thing that distinguishes them, and it
    // carries `adminUserId` explicitly for this purpose.
    const imp = await verifyImpersonation(req);

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(filtered)) {
      const from = (before as unknown as Record<string, unknown>)[key];
      const to = (settings as unknown as Record<string, unknown>)[key];
      if (from !== to) changes[key] = { from, to };
    }

    // Only log real transitions. The settings page PATCHes all three fields
    // on every save, so logging unconditionally would bury an
    // auto-build-off event under no-op writes.
    if (Object.keys(changes).length > 0) {
      try {
        await logAuditEvent({
          shopId: shop_id,
          actorType: imp ? "system" : "merchant",
          actorId: imp?.adminUserId ?? null,
          eventType: "automation_settings_changed",
          eventPayload: { changes, impersonated: !!imp },
        });
      } catch (auditErr) {
        // Never fail the save because the audit write failed —
        // logAuditEvent throws, and a merchant losing a settings change to
        // an audit outage is worse than a missing log line.
        console.error("[automation-settings] audit write failed", auditErr);
      }
    }

    /* AUTO-BUILD BACK ON → replay the disputes it blocked (2026-09-03).
     *
     * A dispute the pipeline exited on `auto_build_off` never retries by
     * itself: `disputeEffectsDispatcher` wraps the pipeline in
     * `withEffectDedup`, which burns its claim BEFORE running the effect, so a
     * second attempt is `already_applied`. Neither rebuild cron rescues it —
     * `refresh-open-disputes` needs delivery to move, and the deadline rebuild
     * counts a pack-less dispute as `skippedNoPack`.
     *
     * So turning auto-build back on used to change the setting and nothing
     * else: every dispute already blocked by it stayed blocked, with no pack
     * and no queued job, until its deadline passed. Found on `6a8848-dd`,
     * where 11 live disputes sat in exactly that state.
     *
     * This is the same gap `replayBlockedBuilds` was written for when CREDITS
     * arrive — same sweep, same guards, same 200-dispute cap, same
     * live-deadlines-only scope. It was simply never wired to this trigger, so
     * we reuse it rather than add a second recovery path.
     *
     * Only on the false→true EDGE: `changes` already holds the real
     * transition, so a no-op save (this page PATCHes all three fields every
     * time) does not sweep. Fire-and-forget — `scheduleBlockedBuildReplay`
     * swallows its own errors, because a failed sweep must never roll back a
     * saved setting. */
    if (changes.auto_build_enabled?.to === true) {
      void scheduleBlockedBuildReplay({
        shopId: shop_id,
        // Dedupes concurrent saves of the same transition into one sweep.
        reference: `auto_build_enabled:${Date.now()}`,
      });
    }

    return NextResponse.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
