import { getServiceClient } from "@/lib/supabase/server";

export interface AdminActor {
  id?: string | null;
  email: string;
}

/**
 * Record a platform-wide admin action (no shop) in `admin_audit_events`.
 *
 * Never throws: the audit write must not undo an action that already happened,
 * but a failure is logged loudly and returned so the caller can surface it.
 * (The previous attempt inserted into `audit_events`, whose `shop_id` is NOT
 * NULL — every insert failed silently and the trail stayed empty.)
 */
export async function logAdminAction(input: {
  actor: AdminActor;
  eventType: string;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    const { error } = await getServiceClient().from("admin_audit_events").insert({
      actor_user_id: input.actor.id ?? null,
      actor_email: input.actor.email,
      event_type: input.eventType,
      event_payload: input.payload ?? {},
    });
    if (error) {
      console.error("[admin-audit] write failed", { eventType: input.eventType, message: error.message });
      return false;
    }
    return true;
  } catch (e) {
    // Client construction / network failure: same contract — never throw.
    console.error("[admin-audit] write threw", {
      eventType: input.eventType,
      message: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}
