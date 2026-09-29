import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_READS_PER_RUN, needsRead, recordEvidenceSnapshots } from "../evidenceSnapshots";
import {
  clearableFieldHashes,
  evidenceContentHash,
  toEvidenceRecord,
  EVIDENCE_RECORD_QUERY,
  type EvidenceRecord,
} from "@/lib/shopify/evidenceRecord";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-29T12:00:00Z");

function record(text: Partial<EvidenceRecord["text"]> = {}, fileId: string | null = null): EvidenceRecord {
  return toEvidenceRecord({
    uncategorizedText: "",
    accessActivityLog: "",
    ...text,
    uncategorizedFile: fileId ? { id: fileId, originalFileName: "AdditionalEvidence.pdf", fileType: "application/pdf", fileSize: 10 } : null,
  });
}

/** Minimal in-memory stand-in for the three calls the writer makes. */
function fakeDb(disputes: Record<string, unknown>[], snapshots: Record<string, unknown>[]) {
  const inserted: Record<string, unknown>[] = [];
  const updated: { id: unknown; patch: Record<string, unknown> }[] = [];
  const sb = {
    from(table: string) {
      const q = {
        select: () => q,
        in: () => q,
        order: () => Promise.resolve({ data: snapshots, error: null }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: unknown) => {
            updated.push({ id, patch });
            return Promise.resolve({ error: null });
          },
        }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: table === "disputes" ? disputes : snapshots, error: null }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { sb, inserted, updated };
}

const dispute = { id: "d1", status: "under_review", response_cycle: 1, dispute_evidence_gid: "gid://shopify/ShopifyPaymentsDisputeEvidence/1" };

describe("evidence record", () => {
  it("never selects a file url (contents are Shopify-encrypted)", () => {
    expect(EVIDENCE_RECORD_QUERY).not.toMatch(/\burl\b/);
    expect(EVIDENCE_RECORD_QUERY).toMatch(/uncategorizedFile \{ id originalFileName fileType fileSize \}/);
  });

  it("hashes only the three clearable fields, ignoring line endings and padding", () => {
    const a = clearableFieldHashes(record({ uncategorizedText: "Returned.\r\n", accessActivityLog: "Prior disputes" }));
    const b = clearableFieldHashes(record({ uncategorizedText: "  Returned.\n" }));
    expect(Object.keys(a)).toEqual(["uncategorizedText"]);
    expect(a.uncategorizedText).toBe(b.uncategorizedText);
  });

  it("content hash moves with a file upload id", () => {
    expect(evidenceContentHash(record({}, "f1"))).not.toBe(evidenceContentHash(record({}, "f2")));
  });
});

describe("needsRead", () => {
  const base = { id: "s", dispute_id: "d1", observed_status: "under_review", content_hash: "h", cycle: 1 };
  it("reads when there is no row, the status moved, or the last read is a day old", () => {
    expect(needsRead(undefined, "under_review", NOW)).toBe(true);
    expect(needsRead({ ...base, last_confirmed_at: new Date(NOW - 1000).toISOString() }, "needs_response", NOW)).toBe(true);
    expect(needsRead({ ...base, last_confirmed_at: new Date(NOW - DAY).toISOString() }, "under_review", NOW)).toBe(true);
    expect(needsRead({ ...base, last_confirmed_at: new Date(NOW - DAY / 2).toISOString() }, "under_review", NOW)).toBe(false);
  });
});

describe("recordEvidenceSnapshots", () => {
  it("inserts a first row with status, cycle and clearable hashes", async () => {
    const { sb, inserted } = fakeDb([dispute], []);
    const res = await recordEvidenceSnapshots(sb, "shop", [{ disputeId: "d1", status: "under_review" }], {
      read: async () => ({ ok: true, record: record({ uncategorizedText: "The customer has returned the item" }) }),
      now: () => NOW,
    });
    expect(res.inserted).toBe(1);
    expect(inserted[0]).toMatchObject({ dispute_id: "d1", cycle: 1, observed_status: "under_review" });
    expect(Object.keys(inserted[0].field_hashes as object)).toEqual(["uncategorizedText"]);
  });

  it("only confirms when nothing changed", async () => {
    const r = record({ uncategorizedText: "same" });
    const prev = { id: "s1", dispute_id: "d1", observed_status: "under_review", content_hash: evidenceContentHash(r), cycle: 1, last_confirmed_at: new Date(NOW - 2 * DAY).toISOString() };
    const { sb, inserted, updated } = fakeDb([dispute], [prev]);
    const res = await recordEvidenceSnapshots(sb, "shop", [{ disputeId: "d1", status: "under_review" }], {
      read: async () => ({ ok: true, record: r }),
      now: () => NOW,
    });
    expect(res.confirmed).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(updated[0].id).toBe("s1");
  });

  it("writes a new row when the dispute reopened (status and cycle moved)", async () => {
    const r = record({ uncategorizedText: "same" });
    const prev = { id: "s1", dispute_id: "d1", observed_status: "under_review", content_hash: evidenceContentHash(r), cycle: 1, last_confirmed_at: new Date(NOW - 1000).toISOString() };
    const { sb, inserted } = fakeDb([{ ...dispute, status: "needs_response", response_cycle: 2 }], [prev]);
    await recordEvidenceSnapshots(sb, "shop", [{ disputeId: "d1", status: "needs_response" }], {
      read: async () => ({ ok: true, record: r }),
      now: () => NOW,
    });
    expect(inserted[0]).toMatchObject({ cycle: 2, observed_status: "needs_response" });
  });

  it("skips closed disputes and reports read failures without throwing", async () => {
    const { sb, inserted } = fakeDb([dispute], []);
    const res = await recordEvidenceSnapshots(
      sb,
      "shop",
      [{ disputeId: "d1", status: "under_review" }, { disputeId: "d2", status: "won" }],
      { read: async () => ({ ok: false, error: "boom" }), now: () => NOW },
    );
    expect(res.read).toBe(1);
    expect(res.errors[0]).toMatch(/boom/);
    expect(inserted).toHaveLength(0);
  });

  it("caps reads per run and reads status changes first", async () => {
    const many = Array.from({ length: MAX_READS_PER_RUN + 5 }, (_, i) => ({ ...dispute, id: `n${i}`, dispute_evidence_gid: `gid://e/n${i}` }));
    const moved = { ...dispute, id: "moved", status: "needs_response", response_cycle: 2, dispute_evidence_gid: "gid://e/moved" };
    const prev = { id: "s", dispute_id: "moved", observed_status: "under_review", content_hash: "h", cycle: 1, last_confirmed_at: new Date(NOW - 1000).toISOString() };
    const { sb } = fakeDb([...many, moved], [prev]);
    const readGids: string[] = [];
    const res = await recordEvidenceSnapshots(sb, "shop", [...many, moved].map((d) => ({ disputeId: d.id, status: d.status })), {
      read: async (gid) => { readGids.push(gid); return { ok: true, record: record() }; },
      now: () => NOW,
    });
    expect(res.read).toBe(MAX_READS_PER_RUN);
    expect(readGids[0]).toBe("gid://e/moved");
  });
});
