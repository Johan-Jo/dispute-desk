import { describe, it, expect, vi } from "vitest";
import {
  buildRedirectPath,
  isLocalizationSitemapEligible,
  resolveLocalizationRedirect,
} from "@/lib/resources/redirects";

/* ── isLocalizationSitemapEligible ─────────────────────────────── */

describe("isLocalizationSitemapEligible", () => {
  it("includes a clean published row", () => {
    expect(
      isLocalizationSitemapEligible({
        redirect_to_localization_id: null,
        is_excluded_from_sitemap: false,
        quality_status: "published",
      })
    ).toBe(true);
  });

  it("includes a row with null quality_status (legacy / unset)", () => {
    expect(
      isLocalizationSitemapEligible({
        redirect_to_localization_id: null,
        is_excluded_from_sitemap: false,
        quality_status: null,
      })
    ).toBe(true);
  });

  it("excludes a redirected row", () => {
    expect(
      isLocalizationSitemapEligible({
        redirect_to_localization_id: "00000000-0000-0000-0000-000000000001",
        is_excluded_from_sitemap: false,
        quality_status: "published",
      })
    ).toBe(false);
  });

  it("excludes a manually excluded row", () => {
    expect(
      isLocalizationSitemapEligible({
        redirect_to_localization_id: null,
        is_excluded_from_sitemap: true,
        quality_status: "published",
      })
    ).toBe(false);
  });

  it("excludes thin / rewrite_pending / redirected / excluded statuses", () => {
    for (const s of ["thin", "rewrite_pending", "redirected", "excluded"]) {
      expect(
        isLocalizationSitemapEligible({
          redirect_to_localization_id: null,
          is_excluded_from_sitemap: false,
          quality_status: s,
        })
      ).toBe(false);
    }
  });
});

/* ── buildRedirectPath ─────────────────────────────────────────── */

describe("buildRedirectPath", () => {
  it("builds the en-US resources path without locale prefix", () => {
    expect(
      buildRedirectPath({ pathLocale: "en", pillar: "chargebacks", slug: "evidence", routeKind: "resources" })
    ).toBe("/resources/chargebacks/evidence");
  });

  it("prefixes non-en locales", () => {
    expect(
      buildRedirectPath({ pathLocale: "pt", pillar: "chargebacks", slug: "estorno", routeKind: "resources" })
    ).toBe("/pt/resources/chargebacks/estorno");
  });

  it("uses the routeKind path for non-resources routes", () => {
    expect(
      buildRedirectPath({ pathLocale: "en", pillar: "n/a", slug: "refund-template", routeKind: "templates" })
    ).toBe("/templates/refund-template");
    expect(
      buildRedirectPath({ pathLocale: "fr", pillar: "n/a", slug: "x", routeKind: "glossary" })
    ).toBe("/fr/glossary/x");
  });
});

/* ── resolveLocalizationRedirect — DB resolver with mocked client ── */

type FakeRow = {
  id: string;
  locale: string;
  slug: string;
  route_kind: string;
  redirect_to_localization_id: string | null;
  is_published: boolean;
  content_items: { primary_pillar: string; workflow_status: string };
};

function fakeClient(rows: FakeRow[]) {
  const state: { lastId: string } = { lastId: "" };
  return {
    from() {
      return this;
    },
    select() {
      return this;
    },
    eq(_col: string, val: string) {
      state.lastId = val;
      return this;
    },
    async maybeSingle() {
      const row = rows.find((r) => r.id === state.lastId);
      return { data: row ?? null, error: null };
    },
  } as unknown as Parameters<typeof resolveLocalizationRedirect>[1];
}

describe("resolveLocalizationRedirect", () => {
  it("returns null when redirectToId is null/undefined", async () => {
    expect(await resolveLocalizationRedirect(null, fakeClient([]))).toBeNull();
    expect(await resolveLocalizationRedirect(undefined, fakeClient([]))).toBeNull();
  });

  it("returns null when target row is missing", async () => {
    expect(await resolveLocalizationRedirect("missing", fakeClient([]))).toBeNull();
  });

  it("returns null when target is not published", async () => {
    const client = fakeClient([
      {
        id: "t1",
        locale: "en-US",
        slug: "target-slug",
        route_kind: "resources",
        redirect_to_localization_id: null,
        is_published: false,
        content_items: { primary_pillar: "chargebacks", workflow_status: "published" },
      },
    ]);
    expect(await resolveLocalizationRedirect("t1", client)).toBeNull();
  });

  it("returns null when target's content_item is not in published status", async () => {
    const client = fakeClient([
      {
        id: "t1",
        locale: "en-US",
        slug: "target-slug",
        route_kind: "resources",
        redirect_to_localization_id: null,
        is_published: true,
        content_items: { primary_pillar: "chargebacks", workflow_status: "drafting" },
      },
    ]);
    expect(await resolveLocalizationRedirect("t1", client)).toBeNull();
  });

  it("REFUSES to chase a chained redirect (target is itself a redirect)", async () => {
    const client = fakeClient([
      {
        id: "t1",
        locale: "en-US",
        slug: "target",
        route_kind: "resources",
        redirect_to_localization_id: "t2",
        is_published: true,
        content_items: { primary_pillar: "chargebacks", workflow_status: "published" },
      },
    ]);
    expect(await resolveLocalizationRedirect("t1", client)).toBeNull();
  });

  it("returns the resolved target for a healthy redirect", async () => {
    const client = fakeClient([
      {
        id: "t1",
        locale: "pt-BR",
        slug: "estorno-evidencias",
        route_kind: "resources",
        redirect_to_localization_id: null,
        is_published: true,
        content_items: { primary_pillar: "chargebacks", workflow_status: "published" },
      },
    ]);
    const target = await resolveLocalizationRedirect("t1", client);
    expect(target).not.toBeNull();
    expect(target!.pathLocale).toBe("pt");
    expect(target!.pillar).toBe("chargebacks");
    expect(target!.slug).toBe("estorno-evidencias");
    expect(target!.routeKind).toBe("resources");
    expect(buildRedirectPath(target!)).toBe("/pt/resources/chargebacks/estorno-evidencias");
  });
});

/* ── safety: no infinite loops in resolveLocalizationRedirect ─── */

describe("resolveLocalizationRedirect safety", () => {
  it("does not call DB more than once per invocation (one-hop guarantee)", async () => {
    const calls: string[] = [];
    const state: { lastId: string } = { lastId: "" };
    const client = {
      from() {
        return this;
      },
      select() {
        return this;
      },
      eq(_col: string, val: string) {
        calls.push(val);
        state.lastId = val;
        return this;
      },
      async maybeSingle() {
        return {
          data: {
            id: state.lastId,
            locale: "en-US",
            slug: "x",
            route_kind: "resources",
            redirect_to_localization_id: null,
            is_published: true,
            content_items: { primary_pillar: "chargebacks", workflow_status: "published" },
          },
          error: null,
        };
      },
      _eqId: "",
    } as unknown as Parameters<typeof resolveLocalizationRedirect>[1];

    await resolveLocalizationRedirect("once", client);
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe("once");
  });
});

/* keep vi import live for TS even if unused */
void vi;
