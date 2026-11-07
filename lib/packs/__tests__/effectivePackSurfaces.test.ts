/**
 * PR 5 (docs/plans/single-source-architecture-audit.plan.md §3.2, §5): the
 * portal pack page API, the portal dispute page API and the evidence-pack PDF
 * show the SAME effective rows and percentage as the embedded pack API, over the
 * real stored packs (returnCoherenceCases.json). Stored fields are never changed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/middleware/extractShopId", () => ({ extractShopId: () => "shop-1" }));
vi.mock("@/lib/audit/logEvent", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/packs/renderPdf", () => ({ renderPackPdf: vi.fn() }));
vi.mock("@/lib/disputeEvents/emitEvent", () => ({ emitDisputeEvent: vi.fn().mockResolvedValue(undefined) }));

import { getServiceClient } from "@/lib/supabase/server";
import { renderPackPdf } from "@/lib/packs/renderPdf";
import { GET as getPack } from "@/app/api/packs/[packId]/route";
import { GET as getDispute } from "@/app/api/disputes/[id]/route";
import { handleRenderPdf } from "@/lib/jobs/handlers/renderPdfJob";
import { assembleEffectiveChecklist, merchantCompleteness } from "../effectiveChecklist";
import { effectivePackView, toDisplayChecklistRows } from "../effectivePackView";
import cases from "./__fixtures__/returnCoherenceCases.json";

type Case = (typeof cases)[keyof typeof cases];
const fx = (k: keyof typeof cases): Case => cases[k];

/** Chainable Supabase stand-in: every builder method returns itself; awaiting
 *  yields the table's rows, single()/maybeSingle() its first row. */
function fakeDb(tables: Record<string, unknown>) {
  const chain = (table: string): unknown => {
    const b: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        const t = tables[table];
        if (prop === "then") {
          return (res: (v: unknown) => unknown) =>
            res({ data: Array.isArray(t) ? t : t == null ? [] : [t], error: null });
        }
        if (prop === "single" || prop === "maybeSingle") {
          return () => Promise.resolve({ data: Array.isArray(t) ? (t[0] ?? null) : (t ?? null), error: null });
        }
        return () => b;
      },
    });
    return b;
  };
  return { from: (t: string) => chain(t), storage: { from: () => ({ upload: async () => ({ error: null }) }) } };
}

const V1_STORED = [
  { field: "no_return_initiated", label: "Return Status", required: true, present: false },
  { field: "order_confirmation", label: "Order confirmation", required: true, present: true },
];

function packRow(c: Case) {
  return {
    id: "pack-1",
    shop_id: "shop-1",
    dispute_id: "dispute-1",
    status: "ready",
    response_cycle: 1,
    completeness_score: c.storedScore,
    checklist: V1_STORED,
    checklist_v2: c.checklist_v2,
    blockers: [],
    recommended_actions: [],
    pack_json: { sections: c.sections },
    pdf_path: null,
    pack_template_id: null,
    created_at: "2026-11-06T00:00:00Z",
    updated_at: "2026-11-06T00:00:00Z",
    shop: { shop_domain: "x.myshopify.com" },
    dispute: { dispute_gid: "gid://shopify/Dispute/1", dispute_evidence_gid: null, phase: "chargeback", reason: null },
  };
}

function embeddedOracle(c: Case) {
  const eff = assembleEffectiveChecklist({
    storedChecklist: c.checklist_v2,
    disputeReason: null,
    packSections: c.sections,
    evidenceItems: c.items as never,
  });
  return { rows: eff.checklist, pct: merchantCompleteness(eff.checklist) };
}

async function packApi(c: Case) {
  vi.mocked(getServiceClient).mockReturnValue(
    fakeDb({
      evidence_packs: packRow(c),
      evidence_items: c.items,
      shop_settings: { returns_outside_shopify: false },
    }) as never,
  );
  const res = await getPack({ nextUrl: new URL("http://x/api/packs/pack-1") } as never, {
    params: Promise.resolve({ packId: "pack-1" }),
  });
  return res.json();
}

async function disputeApi(c: Case) {
  vi.mocked(getServiceClient).mockReturnValue(
    fakeDb({
      disputes: { id: "dispute-1", shop_id: "shop-1", reason: null, shops: { shop_domain: "x" } },
      evidence_packs: [packRow(c)],
      evidence_items: c.items,
      shop_settings: { returns_outside_shopify: false },
      rules: [],
    }) as never,
  );
  const res = await getDispute({} as never, { params: Promise.resolve({ id: "dispute-1" }) });
  return res.json();
}

async function pdfInput(c: Case) {
  vi.mocked(getServiceClient).mockReturnValue(
    fakeDb({
      evidence_packs: packRow(c),
      disputes: { dispute_gid: "gid://shopify/Dispute/1", reason: "PRODUCT_NOT_RECEIVED" },
      shops: { shop_domain: "x.myshopify.com" },
      audit_events: [],
      evidence_items: c.items,
      shop_settings: { returns_outside_shopify: false },
    }) as never,
  );
  vi.mocked(renderPackPdf).mockResolvedValue({ buffer: Buffer.from("pdf"), contentType: "application/pdf" } as never);
  await handleRenderPdf({ id: "j", shopId: "shop-1", jobType: "render_pdf", entityId: "pack-1", attempts: 0, maxAttempts: 3 });
  return vi.mocked(renderPackPdf).mock.calls[0][0];
}

beforeEach(() => vi.clearAllMocks());

describe("#24612 (RETURNED): every surface equals the embedded effective output", () => {
  const c = fx("24612");
  const oracle = embeddedOracle(c);
  const display = toDisplayChecklistRows(oracle.rows);

  it("oracle sanity: the stored row exists, the effective rows drop it, the percentage moves", () => {
    expect(c.checklist_v2.some((r) => r.field === "no_return_initiated")).toBe(true);
    expect(oracle.rows.some((r) => r.field === "no_return_initiated")).toBe(false);
    expect(oracle.pct).toBeGreaterThan(c.storedScore);
  });

  it("portal pack API: effective rows + percentage equal the embedded ones, no no_return_initiated", async () => {
    const body = await packApi(c);
    expect(body.effective_checklist_v2).toEqual(oracle.rows);
    expect(body.merchant_completeness).toBe(oracle.pct);
    expect(body.effective_checklist).toEqual(display);
    expect(body.effective_checklist.map((r: { field: string }) => r.field)).not.toContain("no_return_initiated");
  });

  it("portal dispute API: per-pack merchant_completeness equals the embedded one", async () => {
    const body = await disputeApi(c);
    expect(body.packs).toHaveLength(1);
    expect(body.packs[0].merchant_completeness).toBe(oracle.pct);
  });

  it("evidence PDF: printed rows and percentage equal the embedded ones, no no_return_initiated", async () => {
    const data = await pdfInput(c);
    expect(data.completenessScore).toBe(oracle.pct);
    expect(data.checklist).toEqual(display);
    expect(data.checklist.map((r) => r.field)).not.toContain("no_return_initiated");
  });
});

describe("stored fields are unchanged and still present", () => {
  const c = fx("24612");

  it("packs API keeps completeness_score, checklist and checklist_v2 verbatim", async () => {
    const body = await packApi(c);
    expect(body.completeness_score).toBe(c.storedScore);
    expect(body.checklist).toEqual(V1_STORED);
    expect(body.checklist_v2).toEqual(c.checklist_v2);
  });

  it("disputes API keeps completeness_score and the other pack fields", async () => {
    const body = await disputeApi(c);
    expect(body.packs[0]).toMatchObject({ id: "pack-1", status: "ready", completeness_score: c.storedScore, blockers: [] });
    // the heavy inputs used to compute the percentage are not returned
    expect(body.packs[0]).not.toHaveProperty("pack_json");
    expect(body.packs[0]).not.toHaveProperty("checklist_v2");
  });

  it("the PDF job persists nothing about the score or checklist", async () => {
    const sb = fakeDb({
      evidence_packs: packRow(c),
      disputes: { dispute_gid: "gid://shopify/Dispute/1", reason: null },
      shops: { shop_domain: "x" },
      audit_events: [],
      evidence_items: [],
      shop_settings: { returns_outside_shopify: false },
    });
    const updates: Array<Record<string, unknown>> = [];
    const orig = sb.from;
    sb.from = (t: string) => {
      const b = orig(t) as Record<string, unknown>;
      return new Proxy(b as object, {
        get(target, prop) {
          if (prop === "update") return (patch: Record<string, unknown>) => (updates.push(patch), orig(t));
          return (target as Record<string | symbol, unknown>)[prop];
        },
      });
    };
    vi.mocked(getServiceClient).mockReturnValue(sb as never);
    vi.mocked(renderPackPdf).mockResolvedValue({ buffer: Buffer.from("pdf"), contentType: "application/pdf" } as never);
    await handleRenderPdf({ id: "j", shopId: "shop-1", jobType: "render_pdf", entityId: "pack-1", attempts: 0, maxAttempts: 3 });
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      expect(Object.keys(u)).not.toContain("completeness_score");
      expect(Object.keys(u)).not.toContain("checklist");
      expect(Object.keys(u)).not.toContain("checklist_v2");
    }
  });
});

describe("pre-stamp pack #99445 keeps its row on every surface", () => {
  const c = fx("99445");
  const oracle = embeddedOracle(c);

  it("oracle keeps no_return_initiated", () => {
    expect(oracle.rows.map((r) => r.field)).toContain("no_return_initiated");
  });

  it("portal pack API, dispute API and PDF all keep it and agree", async () => {
    const body = await packApi(c);
    expect(body.effective_checklist.map((r: { field: string }) => r.field)).toContain("no_return_initiated");
    expect(body.merchant_completeness).toBe(oracle.pct);
    expect((await disputeApi(c)).packs[0].merchant_completeness).toBe(oracle.pct);
    const data = await pdfInput(c);
    expect(data.checklist.map((r) => r.field)).toContain("no_return_initiated");
    expect(data.completenessScore).toBe(oracle.pct);
  });
});

describe("pre-stamp pack #99445 with the no-return row still MISSING (status never recorded)", () => {
  // The real fixture's row is already `available`, which is kept even when
  // contradicted; derive the not-collected variant so an unknown status that
  // is wrongly read as a return becomes observable on every surface.
  const base = fx("99445");
  const c = {
    ...base,
    checklist_v2: base.checklist_v2.map((r) => (r.field === "no_return_initiated" ? { ...r, status: "missing" } : r)),
    sections: base.sections.map((s) => ({
      ...s,
      fieldsProvided: (s.fieldsProvided ?? []).filter((f: string) => f !== "no_return_initiated"),
    })),
  } as unknown as Case;

  it("the missing row stays on every surface (unknown is not a return)", async () => {
    const oracle = embeddedOracle(c);
    expect(oracle.rows.find((r) => r.field === "no_return_initiated")?.status).toBe("missing");
    const body = await packApi(c);
    expect(body.effective_checklist.map((r: { field: string }) => r.field)).toContain("no_return_initiated");
    expect(body.merchant_completeness).toBe(oracle.pct);
    expect((await disputeApi(c)).packs[0].merchant_completeness).toBe(oracle.pct);
    expect((await pdfInput(c)).checklist.map((r) => r.field)).toContain("no_return_initiated");
  });
});

describe("stored fallback when there is nothing to judge", () => {
  it("no stored v2 checklist: no effective fields, PDF prints the stored score and rows", async () => {
    const c = { ...fx("24612"), checklist_v2: [] as never };
    const body = await packApi(c);
    expect(body).not.toHaveProperty("effective_checklist");
    expect(body).not.toHaveProperty("merchant_completeness");
    expect((await disputeApi(c)).packs[0].merchant_completeness).toBeNull();
    const data = await pdfInput(c);
    expect(data.completenessScore).toBe(c.storedScore);
    expect(data.checklist).toEqual(V1_STORED);
  });

  it("effectivePackView returns null for null / empty stored checklists", () => {
    expect(effectivePackView({ checklistV2: null, packSections: [], disputeReason: null })).toBeNull();
    expect(effectivePackView({ checklistV2: [], packSections: [], disputeReason: null })).toBeNull();
  });
});

describe("wiring pin: each surface reads the effective fields", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("portal pack page", () => {
    const s = read("app/(portal)/portal/packs/[packId]/page.tsx");
    expect(s).toMatch(/pack\.merchant_completeness \?\? pack\.completeness_score/);
    expect(s).toMatch(/pack\.effective_checklist \?\? pack\.checklist/);
    expect(s).toMatch(/checklist=\{shownChecklist\}/);
  });
  it("portal dispute page (both places)", () => {
    const s = read("app/(portal)/portal/disputes/[id]/page.tsx");
    expect(s).toMatch(/packs\[0\]\.merchant_completeness \?\? packs\[0\]\.completeness_score/);
    expect(s).toMatch(/p\.merchant_completeness \?\? p\.completeness_score/);
  });
  it("APIs and PDF job go through effectivePackView", () => {
    for (const f of ["app/api/packs/[packId]/route.ts", "app/api/disputes/[id]/route.ts", "lib/jobs/handlers/renderPdfJob.ts"]) {
      expect(read(f)).toMatch(/loadEffectivePackView/);
    }
    expect(read("lib/jobs/handlers/renderPdfJob.ts")).toMatch(/effective\.merchantCompleteness/);
  });
});
