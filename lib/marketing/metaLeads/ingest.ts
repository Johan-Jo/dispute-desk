import { getServiceClient } from "@/lib/supabase/server";
import { sendAdminMetaLeadNotification } from "@/lib/email/sendAdminNotification";
import {
  calTeardownUrl,
  installUrl,
  sendPlaybookEmail,
  unsubscribeUrl,
} from "@/lib/marketing/playbook/leads";
import { listLeadForms, listLeadsSince } from "./graph";
import { parseLead, type ParsedLead } from "./parseLead";
import { buildMetaLeadWelcomeEmail } from "./welcomeEmail";

const DEFAULT_LOOKBACK_S = 3 * 24 * 3600;
/** Overlap with the newest stored lead so a lead Meta delivers late is not missed (dedup is by leadgen_id). */
const OVERLAP_S = 10 * 60;
/** Only welcome leads this fresh, so switching the flag on never emails a stale backlog. */
const WELCOME_MAX_AGE_MS = 24 * 3600 * 1000;

export type IngestResult = {
  forms: number;
  fetched: number;
  inserted: number;
  welcomed: number;
  skipped?: string;
};

function welcomeEnabled(): boolean {
  return process.env.META_LEADS_WELCOME_ENABLED === "1";
}

/**
 * Poll every lead form on the Page for new leads, store them, alert the team, and (when enabled)
 * send the welcome email. Idempotent: leadgen_id is unique, so overlapping polls are safe.
 */
export async function ingestMetaLeads(): Promise<IngestResult> {
  const pageId = process.env.META_PAGE_ID?.trim();
  const token = process.env.META_PAGE_ACCESS_TOKEN?.trim();
  if (!pageId || !token) {
    return { forms: 0, fetched: 0, inserted: 0, welcomed: 0, skipped: "META_PAGE_ID / META_PAGE_ACCESS_TOKEN not set" };
  }

  const sb = getServiceClient();
  const forms = await listLeadForms(pageId, token);
  const result: IngestResult = { forms: forms.length, fetched: 0, inserted: 0, welcomed: 0 };

  for (const form of forms) {
    const { data: newest } = await sb
      .from("meta_leads")
      .select("created_time")
      .eq("form_id", form.id)
      .order("created_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    const newestS = newest?.created_time ? Math.floor(new Date(newest.created_time).getTime() / 1000) : null;
    const since = newestS ? newestS - OVERLAP_S : Math.floor(Date.now() / 1000) - DEFAULT_LOOKBACK_S;

    const leads = await listLeadsSince(form.id, token, since);
    result.fetched += leads.length;
    if (!leads.length) continue;

    const ids = leads.map((l) => l.id);
    const { data: existing } = await sb.from("meta_leads").select("leadgen_id").in("leadgen_id", ids);
    const seen = new Set((existing ?? []).map((r) => r.leadgen_id as string));

    for (const raw of leads) {
      if (seen.has(raw.id)) continue;
      const lead = parseLead(raw);
      const { error } = await sb.from("meta_leads").insert({
        leadgen_id: lead.leadgenId,
        form_id: form.id,
        form_name: form.name,
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
        // 23505 = a concurrent run inserted it first; that run owns the follow-ups.
        if (error.code !== "23505") console.error("[meta-leads] insert failed:", error.message);
        continue;
      }
      result.inserted++;
      if (await followUp(lead, form.name)) result.welcomed++;
    }
  }
  return result;
}

/** Team alert + welcome email for one newly stored lead. Never throws; returns whether a welcome went out. */
async function followUp(lead: ParsedLead, formName: string | null): Promise<boolean> {
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

  if (!welcomeEnabled() || !lead.email) return false;
  const age = lead.createdTime ? Date.now() - new Date(lead.createdTime).getTime() : 0;
  if (age > WELCOME_MAX_AGE_MS) return false;

  const mail = buildMetaLeadWelcomeEmail({
    firstName: lead.fullName?.split(/\s+/)[0] ?? null,
    installUrl: installUrl(),
    bookingUrl: calTeardownUrl(),
    unsubscribeUrl: unsubscribeUrl(lead.email),
  });
  const ok = await sendPlaybookEmail({ to: lead.email, ...mail });
  if (ok) {
    await sb
      .from("meta_leads")
      .update({ welcomed_at: new Date().toISOString() })
      .eq("leadgen_id", lead.leadgenId);
  }
  return ok;
}
