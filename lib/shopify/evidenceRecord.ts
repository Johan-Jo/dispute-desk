/**
 * Everything Shopify holds on a dispute's evidence that our save does not
 * write (retained-evidence plan §1): the six free-text fields and, per file
 * slot, the upload's id and metadata.
 *
 * File CONTENTS are never read. Shopify returns every dispute upload as an
 * encrypted envelope — ours included — so `url` is deliberately not selected.
 */

import { createHash } from "node:crypto";
import { requestShopifyGraphQL } from "./graphql";

export const EVIDENCE_TEXT_FIELDS = [
  "uncategorizedText",
  "refundRefusalExplanation",
  "cancellationRebuttal",
  "refundPolicyDisclosure",
  "cancellationPolicyDisclosure",
  "accessActivityLog",
] as const;
export type EvidenceTextField = (typeof EVIDENCE_TEXT_FIELDS)[number];

/** The only fields the plan may ever clear (§2). */
export const CLEARABLE_TEXT_FIELDS = [
  "uncategorizedText",
  "refundRefusalExplanation",
  "cancellationRebuttal",
] as const satisfies readonly EvidenceTextField[];
export type ClearableTextField = (typeof CLEARABLE_TEXT_FIELDS)[number];

export const EVIDENCE_FILE_SLOTS = [
  "uncategorizedFile",
  "customerCommunicationFile",
  "serviceDocumentationFile",
  "shippingDocumentationFile",
  "refundPolicyFile",
  "cancellationPolicyFile",
] as const;
export type EvidenceFileSlot = (typeof EVIDENCE_FILE_SLOTS)[number];

export interface EvidenceFileMeta {
  id: string | null;
  originalFileName: string | null;
  fileType: string | null;
  fileSize: number | null;
}

export interface EvidenceRecord {
  text: Record<EvidenceTextField, string | null>;
  files: Record<EvidenceFileSlot, EvidenceFileMeta | null>;
}

const FILE_SELECTION = "id originalFileName fileType fileSize";

export const EVIDENCE_RECORD_QUERY = `query DisputeEvidenceRecord($id: ID!) {
  node(id: $id) {
    ... on ShopifyPaymentsDisputeEvidence {
      ${EVIDENCE_TEXT_FIELDS.join("\n      ")}
      ${EVIDENCE_FILE_SLOTS.map((s) => `${s} { ${FILE_SELECTION} }`).join("\n      ")}
    }
  }
}`;

export type EvidenceRecordRead =
  | { ok: true; record: EvidenceRecord }
  | { ok: false; error: string };

export async function readEvidenceRecord(args: {
  shopDomain: string;
  accessToken: string;
  disputeEvidenceGid: string;
  correlationId?: string;
}): Promise<EvidenceRecordRead> {
  try {
    const res = await requestShopifyGraphQL<{ node?: Record<string, unknown> | null }>({
      session: { shopDomain: args.shopDomain, accessToken: args.accessToken },
      query: EVIDENCE_RECORD_QUERY,
      variables: { id: args.disputeEvidenceGid },
      correlationId: args.correlationId,
    });
    if (res.errors && res.errors.length > 0) {
      return { ok: false, error: JSON.stringify(res.errors).slice(0, 300) };
    }
    const node = res.data?.node;
    if (!node) return { ok: false, error: "evidence node not found" };
    return { ok: true, record: toEvidenceRecord(node) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function toEvidenceRecord(node: Record<string, unknown>): EvidenceRecord {
  const text = {} as Record<EvidenceTextField, string | null>;
  for (const f of EVIDENCE_TEXT_FIELDS) {
    const v = node[f];
    text[f] = typeof v === "string" ? v : null;
  }
  const files = {} as Record<EvidenceFileSlot, EvidenceFileMeta | null>;
  for (const s of EVIDENCE_FILE_SLOTS) {
    const v = node[s] as Partial<EvidenceFileMeta> | null | undefined;
    files[s] = v
      ? {
          id: v.id ?? null,
          originalFileName: v.originalFileName ?? null,
          fileType: v.fileType ?? null,
          fileSize: typeof v.fileSize === "number" ? v.fileSize : null,
        }
      : null;
  }
  return { text, files };
}

/** Line endings and surrounding whitespace never make two values differ. */
export function normalizeEvidenceText(v: string | null | undefined): string {
  return (v ?? "").replace(/\r\n?/g, "\n").trim();
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** One hash per clearable field; an empty field has no hash. */
export function clearableFieldHashes(record: EvidenceRecord): Partial<Record<ClearableTextField, string>> {
  const out: Partial<Record<ClearableTextField, string>> = {};
  for (const f of CLEARABLE_TEXT_FIELDS) {
    const v = normalizeEvidenceText(record.text[f]);
    if (v) out[f] = sha256(v);
  }
  return out;
}

/** Changes whenever any text field or any file upload id changes. */
export function evidenceContentHash(record: EvidenceRecord): string {
  const parts = [
    ...EVIDENCE_TEXT_FIELDS.map((f) => `${f}=${normalizeEvidenceText(record.text[f])}`),
    ...EVIDENCE_FILE_SLOTS.map((s) => `${s}=${record.files[s]?.id ?? ""}`),
  ];
  return sha256(parts.join("\u0000"));
}
