import type { GraphLead } from "./parseLead";

const GRAPH = "https://graph.facebook.com/v21.0";
const MAX_PAGES = 5;

export type LeadForm = { id: string; name: string | null };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    // Never echo the URL: it carries the access token.
    throw new Error(`Graph API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

type Paged<T> = { data?: T[]; paging?: { next?: string } };

async function collect<T>(firstUrl: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = firstUrl;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const body: Paged<T> = await getJson<Paged<T>>(url);
    out.push(...(body.data ?? []));
    url = body.paging?.next;
  }
  return out;
}

/** All lead forms on the Page. */
export async function listLeadForms(pageId: string, token: string): Promise<LeadForm[]> {
  const url = `${GRAPH}/${encodeURIComponent(pageId)}/leadgen_forms?fields=id,name&limit=50&access_token=${encodeURIComponent(token)}`;
  const forms = await collect<{ id: string; name?: string }>(url);
  return forms.map((f) => ({ id: f.id, name: f.name ?? null }));
}

/** Leads on one form submitted after `sinceUnix` (seconds). */
export async function listLeadsSince(formId: string, token: string, sinceUnix: number): Promise<GraphLead[]> {
  const filtering = encodeURIComponent(
    JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: sinceUnix }]),
  );
  const url =
    `${GRAPH}/${encodeURIComponent(formId)}/leads?fields=id,created_time,ad_id,ad_name,campaign_name,field_data` +
    `&filtering=${filtering}&limit=100&access_token=${encodeURIComponent(token)}`;
  return collect<GraphLead>(url);
}
