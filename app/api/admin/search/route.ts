import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { loadShopLabels } from "@/lib/admin/shopLabels";
import { displayShopDomain } from "@/lib/shopify/domainHost";

export const runtime = "nodejs";

const PER_GROUP = 5;
const MIN_CHARS = 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SearchItem {
  id: string;
  title: string;
  /** Second line: the myshopify alias for a shop, the merchant for a dispute/job, etc. */
  subtitle: string | null;
  href: string;
  badge?: string | null;
}
export interface SearchGroup {
  key: "shops" | "disputes" | "templates" | "jobs";
  label: string;
  items: SearchItem[];
}

/**
 * GET /api/admin/search?q=…
 *
 * One search across shops (storefront / myshopify domain, name), disputes (order
 * number such as #1084, Shopify dispute id, or the dispute uuid), templates
 * (slug, dispute type) and jobs (type, or the job uuid). Top few per group, empty
 * groups omitted. Behind the /api/admin middleware like every admin route.
 * Pattern characters that would break PostgREST's `or()` syntax are stripped.
 */
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (raw.length < MIN_CHARS) return NextResponse.json({ q: raw, groups: [] as SearchGroup[] });
  const q = raw.replace(/[%,()*\\]/g, "");
  if (q.length < MIN_CHARS) return NextResponse.json({ q: raw, groups: [] as SearchGroup[] });
  const orderQ = q.replace(/^#/, "");
  const isUuid = UUID_RE.test(q);

  const sb = getServiceClient();

  const shopsQ = isUuid
    ? sb.from("shops").select("id, shop_domain, primary_domain, shop_name, plan, uninstalled_at").eq("id", q).limit(PER_GROUP)
    : sb
        .from("shops")
        .select("id, shop_domain, primary_domain, shop_name, plan, uninstalled_at")
        .or(`shop_domain.ilike.%${q}%,primary_domain.ilike.%${q}%,shop_name.ilike.%${q}%`)
        .limit(PER_GROUP);

  const disputesBase = sb
    .from("disputes")
    .select("id, order_name, reason, phase, normalized_status, shop_id")
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .limit(PER_GROUP);
  const disputesQ = isUuid
    ? disputesBase.eq("id", q)
    : disputesBase.or(`order_name.ilike.%${orderQ}%,dispute_gid.ilike.%${orderQ}%`);

  const templatesQ = sb
    .from("pack_templates")
    .select("id, slug, dispute_type, status")
    .or(`slug.ilike.%${q}%,dispute_type.ilike.%${q}%`)
    .limit(PER_GROUP);

  const jobsBase = sb
    .from("jobs")
    .select("id, job_type, status, shop_id, created_at")
    .order("created_at", { ascending: false })
    .limit(PER_GROUP);
  const jobsQ = isUuid ? jobsBase.eq("id", q) : jobsBase.ilike("job_type", `%${q}%`);

  const [shops, disputes, templates, jobs] = await Promise.all([shopsQ, disputesQ, templatesQ, jobsQ]);
  const failed = [shops, disputes, templates, jobs].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const labels = await loadShopLabels(sb, [
    ...(disputes.data ?? []).map((d) => d.shop_id as string | null),
    ...(jobs.data ?? []).map((j) => j.shop_id as string | null),
  ]);
  const merchantOf = (shopId: string | null): string | null => {
    const l = shopId ? labels.get(shopId) : null;
    return l ? displayShopDomain(l) : null;
  };

  const groups: SearchGroup[] = [
    {
      key: "shops",
      label: "Shops",
      items: (shops.data ?? []).map((s) => {
        const shown = displayShopDomain({ shop_domain: s.shop_domain as string, primary_domain: s.primary_domain as string | null });
        return {
          id: s.id as string,
          title: shown,
          subtitle: shown !== s.shop_domain ? (s.shop_domain as string) : null,
          href: `/admin/shops/${s.id}`,
          badge: s.uninstalled_at ? "uninstalled" : ((s.plan as string | null) ?? "free"),
        };
      }),
    },
    {
      key: "disputes",
      label: "Disputes",
      items: (disputes.data ?? []).map((d) => ({
        id: d.id as string,
        title: `${(d.order_name as string | null) ?? "Order"} · ${String(d.reason ?? d.phase ?? "dispute").replace(/_/g, " ")}`,
        subtitle: merchantOf(d.shop_id as string | null),
        href: `/admin/disputes/${d.id}`,
        badge: ((d.normalized_status as string | null) ?? "").replace(/_/g, " ") || null,
      })),
    },
    {
      key: "templates",
      label: "Templates",
      items: (templates.data ?? []).map((t) => ({
        id: t.id as string,
        title: t.slug as string,
        subtitle: ((t.dispute_type as string | null) ?? "").replace(/_/g, " ") || null,
        href: `/admin/templates/${t.id}`,
        badge: t.status as string,
      })),
    },
    {
      key: "jobs",
      label: "Jobs",
      items: (jobs.data ?? []).map((j) => ({
        id: j.id as string,
        title: j.job_type as string,
        subtitle: merchantOf(j.shop_id as string | null),
        href: "/admin/jobs",
        badge: j.status as string,
      })),
    },
  ].filter((g) => g.items.length > 0) as SearchGroup[];

  return NextResponse.json({ q: raw, groups });
}
