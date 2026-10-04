/** A lead as returned by `GET /{form-id}/leads` on the Graph API (the fields we request). */
export type GraphLead = {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  campaign_name?: string;
  field_data?: Array<{ name?: string; values?: string[] }>;
};

export type ParsedLead = {
  leadgenId: string;
  createdTime: string | null;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  company: string | null;
  store: string | null;
  answers: Record<string, string>;
  adId: string | null;
  adName: string | null;
  campaignName: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Meta's standard field names, plus the custom-question names merchants typically choose. */
function pick(answers: Record<string, string>, names: string[]): string | null {
  for (const n of names) {
    const v = answers[n];
    if (v) return v;
  }
  return null;
}

export function parseLead(lead: GraphLead): ParsedLead {
  const answers: Record<string, string> = {};
  for (const f of lead.field_data ?? []) {
    const name = f.name?.trim().toLowerCase();
    const value = f.values?.[0]?.trim();
    if (name && value) answers[name] = value;
  }

  const rawEmail = pick(answers, ["email", "work_email", "email_address"])?.toLowerCase() ?? null;
  const first = answers["first_name"];
  const last = answers["last_name"];
  const fullName = pick(answers, ["full_name", "name"]) ?? ([first, last].filter(Boolean).join(" ") || null);
  const storeKey = Object.keys(answers).find((k) => /(store|shop|website|url)/.test(k));

  return {
    leadgenId: lead.id,
    createdTime: lead.created_time ?? null,
    email: rawEmail && EMAIL_RE.test(rawEmail) ? rawEmail : null,
    fullName,
    phone: pick(answers, ["phone_number", "phone"]),
    company: pick(answers, ["company_name", "company"]),
    store: storeKey ? answers[storeKey] : null,
    answers,
    adId: lead.ad_id ?? null,
    adName: lead.ad_name ?? null,
    campaignName: lead.campaign_name ?? null,
  };
}
