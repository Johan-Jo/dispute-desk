import { getServiceClient } from "@/lib/supabase/server";
import { sendAdminMetaLeadNotification } from "@/lib/email/sendAdminNotification";
import {
  calTeardownUrl,
  installUrl,
  sendPlaybookEmail,
  unsubscribeUrl,
} from "@/lib/marketing/playbook/leads";
import { getFormName, getLead } from "./graph";
import { parseLead, type ParsedLead } from "./parseLead";
import { buildMetaLeadWelcomeEmail } from "./welcomeEmail";

/** Only welcome leads this fresh, so a late retry or a replay never emails a stale lead. */
const WELCOME_MAX_AGE_MS = 24 * 3600 * 1000;

export type ProcessResult = "stored" | "duplicate" | "not_configured";

function welcomeEnabled(): boolean {
  return process.env.META_LEADS_WELCOME_ENABLED === "1";
}

/**
 * Handle one `leadgen` webhook notification: fetch the lead from the Graph API, store it, alert the
 * team, and (when enabled) send the welcome email. Idempotent — `leadgen_id` is unique, so Meta's
 * retries and duplicate deliveries are no-ops. Throws only when the lead could not be fetched or
 * stored, so the route can return 5xx and let Meta retry.
 */
export async function processMetaLead(input: { leadgenId: string; formId: string | null }): Promise<ProcessResult> {
  const token = process.env.META_PAGE_ACCESS_TOKEN?.trim();
  if (!token) return "not_configured";

  const sb = getServiceClient();
  const { data: existing } = await sb
    .from("meta_leads")
    .select("id")
    .eq("leadgen_id", input.leadgenId)
    .maybeSingle();
  if (existing) return "duplicate";

  const raw = await getLead(input.leadgenId, token);
  const formId = raw.form_id ?? input.formId;
  const formName = formId ? await getFormName(formId, token) : null;
  const lead = parseLead(raw);

  const { error } = await sb.from("meta_leads").insert({
    leadgen_id: lead.leadgenId,
    form_id: formId,
    form_name: formName,
    ad_id: lead.adId,
    ad_name: lead.adName,
    campaign_name: lead.campaignName,
    email: lead.email,
    full_name: lead.fullName,
    phone: lead.phone,
    company: lead.company,
    store: lead.store,
    answers: lead.answers,
    created_time: lead.createdTime,
  });
  if (error) {
    // 23505 = a concurrent delivery stored it first; that one owns the follow-ups.
    if (error.code === "23505") return "duplicate";
    throw new Error(`meta_leads insert failed: ${error.message}`);
  }

  await followUp(lead, formName);
  return "stored";
}

/** Team alert + welcome email for one newly stored lead. Never throws. */
async function followUp(lead: ParsedLead, formName: string | null): Promise<void> {
  const sb = getServiceClient();
  try {
    await sendAdminMetaLeadNotification({
      email: lead.email,
      fullName: lead.fullName,
      company: lead.company,
      store: lead.store,
      phone: lead.phone,
      campaignName: lead.campaignName,
      adName: lead.adName,
      formName,
      answers: lead.answers,
    });
    await sb
      .from("meta_leads")
      .update({ admin_notified_at: new Date().toISOString() })
      .eq("leadgen_id", lead.leadgenId);
  } catch (err) {
    console.error("[meta-leads] admin notify failed:", err);
  }

  if (!welcomeEnabled() || !lead.email) return;
  const age = lead.createdTime ? Date.now() - new Date(lead.createdTime).getTime() : 0;
  if (age > WELCOME_MAX_AGE_MS) return;

  const mail = buildMetaLeadWelcomeEmail({
    firstName: lead.fullName?.split(/\s+/)[0] ?? null,
    installUrl: installUrl(),
    bookingUrl: calTeardownUrl(),
    unsubscribeUrl: unsubscribeUrl(lead.email),
  });
  if (await sendPlaybookEmail({ to: lead.email, ...mail })) {
    await sb
      .from("meta_leads")
      .update({ welcomed_at: new Date().toISOString() })
      .eq("leadgen_id", lead.leadgenId);
  }
}
