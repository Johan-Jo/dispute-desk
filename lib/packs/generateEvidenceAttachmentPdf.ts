/**
 * `generateEvidenceAttachmentPdf` — single PDF generator facade for
 * the conditional file evidence layer (Phase 3 / Phase 4 of
 * `docs/plans/conditional_file_evidence_layer.plan.md`).
 *
 * One entry point. Internal layout branches on `attachmentType` only;
 * content selection branches on `evidenceFieldKey` + sections payload.
 * Returns a Buffer of PDF bytes ready for upload via
 * `lib/shopify/disputeFileUpload.ts`.
 *
 * Design constraint (from the plan): never expose more than the merchant
 * has actually provided. We do NOT synthesise claims — we re-present
 * facts already on the pack in a single, focused document Shopify Admin
 * can render in the chargeback-response UI.
 */
import React from "react";
import type {
  EvidenceAttachmentPdfData,
  EvidenceAttachmentPdfFact,
} from "./pdf/EvidenceAttachmentDocument";
import {
  getEvidenceAttachmentDocumentModule,
  getReactPdfRenderer,
} from "./pdf/reactPdfRuntime";
import type { AttachmentType } from "@/lib/shopify/decideFileAttachments";

/** Pack-section shape — formerly imported from the deleted
 *  `lib/shopify/fieldMapping.ts`. Inlined here because this module
 *  needs it for type-only extraction inside the file-evidence layer. */
export interface RawPackSection {
  type: string;
  label: string;
  source: string;
  fieldsProvided?: string[];
  data: Record<string, unknown>;
}

/* ── Public API ─────────────────────────────────────────────────────── */

export interface GenerateEvidenceAttachmentPdfInput {
  attachmentType: AttachmentType;
  evidenceFieldKey: string;
  /** Reason string from `decideFileAttachments` — printed verbatim
   *  under "Reason for inclusion". */
  reason: string;
  shopDomain: string;
  disputeId: string;
  /** All sections from the pack — used for fact extraction per type. */
  sections: RawPackSection[];
  /** Merchant-provided label on the evidence item. Optional. */
  label?: string | null;
  /** Payload from the candidate evidence item (used as fallback content
   *  when no relevant pack section exists). Optional. */
  payload?: Record<string, unknown> | null;
  /** Override the timestamp embedded in the PDF (testing). Defaults to
   *  current ISO. */
  generatedAtIso?: string;
}

const TITLE_BY_TYPE: Record<AttachmentType, string> = {
  delivery: "Delivery confirmation",
  communication: "Customer communication",
  service: "Service documentation",
  policy: "Policy acceptance",
  other: "Supporting documentation",
};

/* ── Per-type fact extractors ───────────────────────────────────────── */

function pick(record: Record<string, unknown> | undefined, key: string): string | null {
  if (!record) return null;
  const v = record[key];
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function extractDeliveryFacts(sections: RawPackSection[], payload: Record<string, unknown> | null | undefined): EvidenceAttachmentPdfFact[] {
  const facts: EvidenceAttachmentPdfFact[] = [];
  // Pull from sections.type === "shipping" first (canonical pack source).
  const shipping = sections.find(s => s.type === "shipping");
  const data = (shipping?.data ?? {}) as Record<string, unknown>;
  const status = pick(data, "overallStatus");
  if (status) facts.push({ label: "Overall status", value: status });

  const fulfillments = Array.isArray(data.fulfillments) ? data.fulfillments : [];
  const f0 = (fulfillments[0] ?? {}) as Record<string, unknown>;
  const fStatus = pick(f0, "status");
  if (fStatus) facts.push({ label: "Fulfillment status", value: fStatus });
  const createdAt = pick(f0, "createdAt");
  if (createdAt) facts.push({ label: "Shipped", value: createdAt });
  const deliveredAt = pick(f0, "deliveredAt");
  if (deliveredAt) facts.push({ label: "Delivered", value: deliveredAt });

  const tracking = Array.isArray(f0.tracking) ? f0.tracking : [];
  const t0 = (tracking[0] ?? {}) as Record<string, unknown>;
  const carrier = pick(t0, "carrier");
  if (carrier) facts.push({ label: "Carrier", value: carrier });
  const number = pick(t0, "number");
  if (number) facts.push({ label: "Tracking number", value: number });

  // Fall back to the candidate's own payload — proofType, etc.
  const proofType = pick(payload as Record<string, unknown> | undefined, "proofType");
  if (proofType) facts.push({ label: "Proof type", value: proofType });

  return facts;
}

function extractCommunicationFacts(sections: RawPackSection[], payload: Record<string, unknown> | null | undefined): EvidenceAttachmentPdfFact[] {
  const facts: EvidenceAttachmentPdfFact[] = [];
  const comm = sections.find(s => s.type === "customer_communication");
  const data = (comm?.data ?? {}) as Record<string, unknown>;
  const messageCount = pick(data, "messageCount");
  if (messageCount) facts.push({ label: "Messages", value: messageCount });
  const lastMessageAt = pick(data, "lastMessageAt");
  if (lastMessageAt) facts.push({ label: "Last message", value: lastMessageAt });
  // Payload-side claims (only when explicitly true — never invent).
  if ((payload as Record<string, unknown> | undefined)?.customerConfirmsOrder === true) {
    facts.push({ label: "Customer confirms order", value: "Yes" });
  }
  return facts;
}

function extractServiceFacts(_sections: RawPackSection[], payload: Record<string, unknown> | null | undefined): EvidenceAttachmentPdfFact[] {
  const facts: EvidenceAttachmentPdfFact[] = [];
  const p = (payload ?? {}) as Record<string, unknown>;
  if (p.digitalAccessUsed === true) {
    facts.push({ label: "Digital access used", value: "Yes" });
  }
  if (p.decisiveSessionProof === true) {
    facts.push({ label: "Decisive session proof", value: "Yes" });
  }
  const lastAccessedAt = pick(p, "lastAccessedAt");
  if (lastAccessedAt) facts.push({ label: "Last accessed", value: lastAccessedAt });
  return facts;
}

function extractPolicyFacts(_sections: RawPackSection[], payload: Record<string, unknown> | null | undefined): { facts: EvidenceAttachmentPdfFact[]; body: string | null } {
  const facts: EvidenceAttachmentPdfFact[] = [];
  const p = (payload ?? {}) as Record<string, unknown>;
  if (p.acceptedAtCheckout === true) {
    facts.push({ label: "Accepted at checkout", value: "Yes" });
  }
  const ts = pick(p, "acceptanceTimestamp");
  if (ts) facts.push({ label: "Acceptance timestamp", value: ts });
  const text = typeof p.text === "string" ? p.text : null;
  return { facts, body: text };
}

/* ── Main ───────────────────────────────────────────────────────────── */

export async function generateEvidenceAttachmentPdf(
  input: GenerateEvidenceAttachmentPdfInput,
): Promise<Buffer> {
  const {
    attachmentType,
    evidenceFieldKey,
    reason,
    shopDomain,
    disputeId,
    sections,
    label,
    payload,
    generatedAtIso = new Date().toISOString(),
  } = input;

  let facts: EvidenceAttachmentPdfFact[] = [];
  let body: string | null = null;

  switch (attachmentType) {
    case "delivery":
      facts = extractDeliveryFacts(sections, payload);
      break;
    case "communication":
      facts = extractCommunicationFacts(sections, payload);
      break;
    case "service":
      facts = extractServiceFacts(sections, payload);
      break;
    case "policy": {
      const r = extractPolicyFacts(sections, payload);
      facts = r.facts;
      body = r.body;
      break;
    }
    case "other":
      // No type-specific extraction. Fall back to label only; the
      // surrounding meta + reason blocks are sufficient context.
      facts = [];
      break;
    default: {
      const exhaustive: never = attachmentType;
      throw new Error(`Unknown attachmentType: ${String(exhaustive)}`);
    }
  }

  const data: EvidenceAttachmentPdfData = {
    attachmentType,
    evidenceFieldKey,
    title: TITLE_BY_TYPE[attachmentType],
    label: label ?? null,
    reason,
    shopDomain,
    disputeId,
    generatedAtIso,
    facts,
    body,
  };

  // Dynamic-import BOTH the renderer and the document module from the
  // same runtime call. Statically importing `EvidenceAttachmentDocument`
  // here while dynamic-importing the renderer creates two separate
  // bundles for `@react-pdf/renderer` under webpack — the document
  // links to one React instance, the renderer to another, and rendering
  // throws React error #31 ("object passed where text expected") because
  // the elements aren't recognized as React elements by the renderer.
  // Same pattern as `lib/jobs/handlers/renderPdfJob.ts`.
  const { renderToBuffer } = await getReactPdfRenderer();
  const { EvidenceAttachmentDocument } = await getEvidenceAttachmentDocumentModule();
  const bytes = await renderToBuffer(React.createElement(EvidenceAttachmentDocument, { data }));
  return Buffer.from(bytes);
}
