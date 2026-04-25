/**
 * Pure text-block formatter for the "Supporting documents" section
 * appended to `uncategorizedText` when submitting dispute evidence to
 * Shopify.
 *
 * Shopify's public Admin API does not let third-party apps attach
 * files to chargeback disputes (see `lib/shopify/disputeFileUpload.ts`),
 * so callers (the save-to-shopify job handler) mint DisputeDesk URLs
 * via the HMAC helper in `lib/links/attachmentLinks.ts` and pass them
 * here. This file is I/O free — no env, no DB, no Supabase — so it
 * can be unit-tested in isolation and reused from anywhere.
 *
 * Output shape (pinned by tests):
 *
 *   Supporting documents (secure access links):
 *
 *   Fulfillment & Delivery:
 *   - <Evidence type> - <filename>
 *     https://disputedesk.app/e/<token>
 *   - <Evidence type> - <filename>
 *     https://disputedesk.app/e/<token>
 *
 *   Customer Communication:
 *   - <Evidence type> - <filename>
 *     https://disputedesk.app/e/<token>
 *
 *   Full evidence pack (PDF):
 *   - Evidence pack
 *     https://disputedesk.app/e/<token>
 *
 * Section headings:
 *   Each `ManualAttachmentInput` may include `checklistField` (stored on
 *   upload as `evidence_items.payload.checklistField`). That drives the
 *   printed heading so it matches the Evidence-tab row (e.g. "Delivery proof",
 *   "Supporting Documents"). When `checklistField` is absent (legacy rows),
 *   we fall back to label heuristics + dispute-reason priority, then the
 *   generic "Supporting documents" group.
 *
 * Multi-purpose evidence handling (legacy / label-only rows):
 *   A merchant's upload label often spans more than one category — e.g.
 *   "Delivery confirmation email" is both Fulfillment and Communication.
 *   We list each upload **once**, under the most decisive category for
 *   the dispute reason (priority tables below), and put the merchant's
 *   evidence type as a short prefix on the file line so the bank still
 *   sees the secondary role inline.
 *
 * Dates and file sizes are intentionally NOT rendered in the bank-facing
 * text. The merchant-entered evidence type (prefix) describes what the
 * evidence is, the filename identifies the linked document, and the URL
 * delivers the file itself.
 */

import {
  DISPUTE_REASON_FAMILIES,
  type AllDisputeReasonCode,
} from "@/lib/rules/disputeReasons";

export interface ManualAttachmentInput {
  /**
   * Checklist field key from the Evidence tab row (e.g. `delivery_proof`,
   * `supporting_documents`). When set, grouping uses this — not filename
   * heuristics — so bank-facing headings match where the merchant uploaded.
   */
  checklistField?: string | null;
  /** Human-readable label entered by the merchant at upload time. */
  label: string | null;
  /** Original filename as uploaded. */
  fileName: string | null;
  /**
   * File size in bytes. Retained on the input as one of the fallback
   * deduplication components; not rendered in the bank-facing output.
   */
  fileSize: number | null;
  /**
   * ISO timestamp of the upload. Used as a fallback deduplication
   * component; not rendered in the bank-facing output.
   */
  createdAt: string | null;
  /** Full DisputeDesk URL the bank follows to fetch this file. */
  url: string;
  /**
   * Optional stable identifier (e.g. the Supabase storage path or the
   * `evidence_items.id`). Preferred deduplication key when supplied;
   * callers that omit it fall back to filename + size + date.
   */
  id?: string | null;
}

export interface PackPdfInput {
  /** Full DisputeDesk URL for the rendered pack PDF. */
  url: string;
}

/** Exact top-level header text — pinned by tests. */
export const MANUAL_ATTACHMENTS_HEADER =
  "Supporting documents (secure access links):";

/**
 * Group label used for uploads that don't map to any of the seven
 * Evidence-tab categories (e.g. unlabeled, or label==filename).
 */
const DEFAULT_GROUP_LABEL = "Supporting documents";

/** Dedicated section for the rendered evidence pack PDF, always last. */
const PDF_SECTION_LABEL = "Full evidence pack (PDF)";
const PDF_FILE_LABEL = "Evidence pack";

/**
 * Canonical Evidence-tab category headings (kept in sync with
 * `workspace-components/types.ts > EvidenceCategory`). The order here
 * is irrelevant — actual rendering order comes from the reason-family
 * priority tables below.
 */
const CATEGORY_LABELS = [
  "Order Facts",
  "Payment Verification",
  "Customer Identity & History",
  "Fulfillment & Delivery",
  "Customer Communication",
  "Merchant Evidence",
  "Policies & Disclosures",
] as const;

type EvidenceCategory = (typeof CATEGORY_LABELS)[number];

/**
 * Map checklist `field` values (workspace / `evidence_items.payload.checklistField`)
 * to Evidence-tab **category** headings for sort order and fallback display.
 */
const CHECKLIST_FIELD_TO_CATEGORY: Record<string, EvidenceCategory> = {
  order_confirmation: "Order Facts",
  billing_address_match: "Order Facts",
  avs_cvv_match: "Payment Verification",
  shipping_tracking: "Fulfillment & Delivery",
  delivery_proof: "Fulfillment & Delivery",
  shipping_policy: "Policies & Disclosures",
  customer_communication: "Customer Communication",
  refund_policy: "Policies & Disclosures",
  cancellation_policy: "Policies & Disclosures",
  activity_log: "Customer Identity & History",
  ip_location_check: "Customer Identity & History",
  device_session_consistency: "Customer Identity & History",
  supporting_documents: "Merchant Evidence",
  product_description: "Merchant Evidence",
  duplicate_explanation: "Merchant Evidence",
};

/**
 * Per-row headings shown on the Evidence tab for manual (or manual-capable)
 * fields — used as the **printed section title** before each file/link block.
 * When absent, we fall back to the category heading above.
 */
const CHECKLIST_FIELD_TO_SUBMISSION_HEADING: Record<string, string> = {
  supporting_documents: "Supporting Documents",
  product_description: "Product Description",
  duplicate_explanation: "Duplicate Explanation",
  delivery_proof: "Delivery proof",
  shipping_tracking: "Shipping & tracking",
  customer_communication: "Customer Communication",
  refund_policy: "Refund Policy",
  shipping_policy: "Shipping Policy",
  cancellation_policy: "Cancellation Policy",
  billing_address_match: "Billing address match",
  order_confirmation: "Order confirmation",
  activity_log: "Customer history",
  avs_cvv_match: "Payment verification (AVS/CVV)",
  ip_location_check: "IP & location check",
  device_session_consistency: "Device session consistency",
};

/**
 * Exported for tests. Returns the Evidence-tab category for a checklist field.
 */
export function categoryFromChecklistField(
  field: string | null | undefined,
): EvidenceCategory | null {
  if (!field || !field.trim()) return null;
  return CHECKLIST_FIELD_TO_CATEGORY[field.trim()] ?? null;
}

function submissionHeadingFromChecklistField(
  field: string | null | undefined,
): string | null {
  if (!field || !field.trim()) return null;
  const key = field.trim();
  const row = CHECKLIST_FIELD_TO_SUBMISSION_HEADING[key];
  if (row) return row;
  const cat = CHECKLIST_FIELD_TO_CATEGORY[key];
  return cat ?? null;
}

/**
 * Priority order per dispute-reason family — highest-priority category
 * first. When a single upload label matches more than one category, the
 * highest-priority category for the dispute's family wins.
 *
 * Families come from `lib/rules/disputeReasons.ts > DISPUTE_REASON_FAMILIES`.
 * The default order (used for unknown/missing reason) preserves the
 * historical first-match behaviour: Fulfillment → Communication →
 * Identity → Payment → Policies → Merchant → Order.
 */
const DEFAULT_CATEGORY_PRIORITY: readonly EvidenceCategory[] = [
  "Fulfillment & Delivery",
  "Customer Communication",
  "Customer Identity & History",
  "Payment Verification",
  "Policies & Disclosures",
  "Merchant Evidence",
  "Order Facts",
];

const CATEGORY_PRIORITY_BY_FAMILY: Record<string, readonly EvidenceCategory[]> = {
  Fraud: [
    "Fulfillment & Delivery",
    "Customer Identity & History",
    "Payment Verification",
    "Customer Communication",
    "Merchant Evidence",
    "Order Facts",
    "Policies & Disclosures",
  ],
  Fulfillment: [
    "Fulfillment & Delivery",
    "Customer Communication",
    "Order Facts",
    "Customer Identity & History",
    "Merchant Evidence",
    "Payment Verification",
    "Policies & Disclosures",
  ],
  Subscription: [
    "Customer Communication",
    "Policies & Disclosures",
    "Order Facts",
    "Merchant Evidence",
    "Customer Identity & History",
    "Fulfillment & Delivery",
    "Payment Verification",
  ],
  Quality: [
    "Customer Communication",
    "Merchant Evidence",
    "Policies & Disclosures",
    "Order Facts",
    "Fulfillment & Delivery",
    "Customer Identity & History",
    "Payment Verification",
  ],
  Refund: [
    "Customer Communication",
    "Policies & Disclosures",
    "Order Facts",
    "Merchant Evidence",
    "Fulfillment & Delivery",
    "Customer Identity & History",
    "Payment Verification",
  ],
  Billing: [
    "Order Facts",
    "Customer Communication",
    "Policies & Disclosures",
    "Merchant Evidence",
    "Customer Identity & History",
    "Fulfillment & Delivery",
    "Payment Verification",
  ],
  Authorization: [
    "Payment Verification",
    "Customer Identity & History",
    "Customer Communication",
    "Order Facts",
    "Fulfillment & Delivery",
    "Merchant Evidence",
    "Policies & Disclosures",
  ],
  Compliance: [
    "Policies & Disclosures",
    "Customer Communication",
    "Merchant Evidence",
    "Order Facts",
    "Customer Identity & History",
    "Fulfillment & Delivery",
    "Payment Verification",
  ],
};

/**
 * Strip emoji/pictographic characters from filenames and labels before
 * rendering. Kept intentionally conservative: matches the Unicode
 * `Extended_Pictographic` property plus the VS16 selector and ZWJ, which
 * together cover modern emoji sequences without touching regular
 * punctuation, digits, or accented Latin/non-Latin letters.
 *
 * Example: "📄 CONTRATO.pdf" -> "CONTRATO.pdf"
 */
const EMOJI_RE = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;

function stripEmojis(raw: string): string {
  return raw.replace(EMOJI_RE, "").trim();
}

function sanitizeFilename(raw: string | null | undefined): string {
  if (!raw) return "document";
  const cleaned = stripEmojis(raw);
  return cleaned.length > 0 ? cleaned : "document";
}

function sanitizeLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = stripEmojis(raw);
  return cleaned.length > 0 ? cleaned : null;
}

/** Map a Shopify reason code to its family (case/whitespace-tolerant). */
function reasonFamilyFromCode(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const code = reason.trim().toUpperCase().replace(/\s+/g, "_") as AllDisputeReasonCode;
  return DISPUTE_REASON_FAMILIES[code] ?? null;
}

function priorityFor(reason: string | null | undefined): readonly EvidenceCategory[] {
  const family = reasonFamilyFromCode(reason);
  if (family && CATEGORY_PRIORITY_BY_FAMILY[family]) {
    return CATEGORY_PRIORITY_BY_FAMILY[family];
  }
  return DEFAULT_CATEGORY_PRIORITY;
}

/** Collect every Evidence-tab category a label could plausibly belong to. */
function matchingCategoriesForLabel(
  rawLabel: string | null | undefined,
): EvidenceCategory[] {
  const trimmed = rawLabel?.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();

  const exact = CATEGORY_LABELS.find((c) => c.toLowerCase() === lower);
  if (exact) return [exact];

  const hits: EvidenceCategory[] = [];
  if (
    lower.includes("delivery") ||
    lower.includes("fulfillment") ||
    lower.includes("shipping") ||
    lower.includes("tracking")
  ) {
    hits.push("Fulfillment & Delivery");
  }
  if (
    lower.includes("communication") ||
    lower.includes("email") ||
    lower.includes("message") ||
    lower.includes("chat")
  ) {
    hits.push("Customer Communication");
  }
  if (
    lower.includes("customer history") ||
    lower.includes("identity") ||
    lower.includes("activity") ||
    // Word-bounded `ip` so we don't match "rece[ip]t", "[ip]ad", "sh[ip]ping",
    // "t[ip]". The earlier `includes("ip")` was a latent over-match.
    /\bip\b/.test(lower) ||
    lower.includes("location")
  ) {
    hits.push("Customer Identity & History");
  }
  if (
    lower.includes("payment") ||
    lower.includes("avs") ||
    lower.includes("cvv")
  ) {
    hits.push("Payment Verification");
  }
  if (
    lower.includes("policy") ||
    lower.includes("disclosure") ||
    lower.includes("terms")
  ) {
    hits.push("Policies & Disclosures");
  }
  if (
    lower.includes("merchant") ||
    lower.includes("product") ||
    lower.includes("duplicate") ||
    lower.includes("supporting document")
  ) {
    hits.push("Merchant Evidence");
  }
  if (
    lower.includes("order") ||
    lower.includes("invoice") ||
    lower.includes("receipt")
  ) {
    hits.push("Order Facts");
  }
  return hits;
}

/**
 * Pick the single primary category for an upload, breaking multi-category
 * ties using the dispute reason's family priority. Returns `null` when
 * the label doesn't match any category — caller groups under the
 * fallback "Supporting documents" heading in that case.
 *
 * Exported for unit tests; not used outside this module.
 */
export function selectPrimaryCategory(
  rawLabel: string | null | undefined,
  disputeReason: string | null | undefined,
): EvidenceCategory | null {
  const hits = matchingCategoriesForLabel(rawLabel);
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  const priority = priorityFor(disputeReason);
  for (const category of priority) {
    if (hits.includes(category)) return category;
  }
  return hits[0];
}

/**
 * Decide what to render as the inline evidence-type prefix on a file
 * line. Returns `null` when adding a prefix wouldn't add information:
 *  - label missing
 *  - label equals the filename (after sanitisation)
 *  - label equals the resolved category heading (case-insensitive)
 *  - label equals the fallback group label
 */
function resolveInlinePrefix(
  rawLabel: string | null | undefined,
  sanitizedFileName: string,
  groupLabel: string,
): string | null {
  const sanitized = sanitizeLabel(rawLabel);
  if (!sanitized) return null;
  if (sanitized === sanitizedFileName) return null;
  const lower = sanitized.toLowerCase();
  if (lower === groupLabel.toLowerCase()) return null;
  if (lower === DEFAULT_GROUP_LABEL.toLowerCase()) return null;
  return sanitized;
}

function dedupeKeyFor(u: ManualAttachmentInput): string {
  if (u.id && u.id.trim().length > 0) return `id:${u.id.trim()}`;
  const name = sanitizeFilename(u.fileName);
  const size = typeof u.fileSize === "number" ? u.fileSize : "";
  const date = u.createdAt ? u.createdAt.slice(0, 10) : "";
  return `fb:${name}|${size}|${date}`;
}

interface RenderItem {
  upload: ManualAttachmentInput;
  fileName: string;
  prefix: string | null;
}

interface RenderGroup {
  label: string;
  /** Sort key used to order groups within the rendered block. */
  sortKey: number;
  items: RenderItem[];
}

/**
 * Build the attachments block. Returns `null` when there is nothing to
 * cite (empty uploads and no PDF), so callers can cleanly skip the
 * append step.
 *
 * `disputeReason` (optional) is the Shopify dispute reason code (e.g.
 * `"FRAUDULENT"`, `"SUBSCRIPTION_CANCELED"`). It only affects ordering
 * for multi-category labels; no other behaviour is reason-sensitive.
 */
export function formatManualAttachmentsBlock(
  uploads: ManualAttachmentInput[],
  pdf: PackPdfInput | null,
  disputeReason?: string | null,
): string | null {
  const seen = new Set<string>();
  const unique: ManualAttachmentInput[] = [];
  for (const u of uploads) {
    const key = dedupeKeyFor(u);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(u);
  }

  const priority = priorityFor(disputeReason);
  const fallbackSortKey = priority.length; // fallback group renders after categorised groups

  const groups = new Map<string, RenderGroup>();
  for (const u of unique) {
    const fileName = sanitizeFilename(u.fileName);
    const categoryFromField = categoryFromChecklistField(u.checklistField);
    const categoryFromLabel = selectPrimaryCategory(u.label, disputeReason);
    const categoryForSort = categoryFromField ?? categoryFromLabel;
    const groupHeading =
      submissionHeadingFromChecklistField(u.checklistField) ??
      categoryForSort ??
      DEFAULT_GROUP_LABEL;
    const sortKey = categoryForSort ? priority.indexOf(categoryForSort) : fallbackSortKey;
    const prefix = resolveInlinePrefix(u.label, fileName, groupHeading);

    let group = groups.get(groupHeading);
    if (!group) {
      group = { label: groupHeading, sortKey, items: [] };
      groups.set(groupHeading, group);
    }
    group.items.push({ upload: u, fileName, prefix });
  }

  const orderedGroups = Array.from(groups.values()).sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    return a.label.localeCompare(b.label);
  });

  const sections: string[] = [];
  for (const g of orderedGroups) {
    const lines: string[] = [`${g.label}:`];
    for (const item of g.items) {
      const fileLine = item.prefix
        ? `- ${item.prefix} - ${item.fileName}`
        : `- ${item.fileName}`;
      lines.push(fileLine);
      lines.push(`  ${item.upload.url}`);
    }
    sections.push(lines.join("\n"));
  }

  if (pdf) {
    sections.push(
      [
        `${PDF_SECTION_LABEL}:`,
        `- ${PDF_FILE_LABEL}`,
        `  ${pdf.url}`,
      ].join("\n"),
    );
  }

  if (sections.length === 0) return null;

  return `${MANUAL_ATTACHMENTS_HEADER}\n\n${sections.join("\n\n")}`;
}
