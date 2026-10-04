import type { GraphLead } from "./parseLead";

const GRAPH = "https://graph.facebook.com/v21.0";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    // Never echo the URL: it carries the access token.
    throw new Error(`Graph API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** The full lead (answers + ad/campaign names) for a `leadgen_id` the webhook announced. */
export async function getLead(leadgenId: string, token: string): Promise<GraphLead & { form_id?: string }> {
  const url =
    `${GRAPH}/${encodeURIComponent(leadgenId)}?fields=id,created_time,ad_id,ad_name,campaign_name,form_id,field_data` +
    `&access_token=${encodeURIComponent(token)}`;
  return getJson(url);
}

/** Best-effort form name for the team alert; null on any failure. */
export async function getFormName(formId: string, token: string): Promise<string | null> {
  try {
    const url = `${GRAPH}/${encodeURIComponent(formId)}?fields=name&access_token=${encodeURIComponent(token)}`;
    return (await getJson<{ name?: string }>(url)).name ?? null;
  } catch {
    return null;
  }
}
