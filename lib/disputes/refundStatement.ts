/**
 * The refund statement: the ONE merchant-facing statement of what Shopify
 * records about refunds on an order.
 *
 * ── WHY ONE CONTRACT ──────────────────────────────────────────────────
 *
 * The pack stores a zero-total refund entry (`refundHistory.refunds[]`) for a
 * refund whose transactions failed, are pending, or have not settled, and the
 * pack keeps no transaction status: a failed entry, a pending one, a
 * later-successful one and an entry without transactions are
 * indistinguishable from a zero entry. Surfaces that read the amount said
 * "no refund"; surfaces that read the entries said "a refund exists"; two of
 * them could disagree on the same dispute. This module is the only reader of
 * `order.totals.refunded` and `refundHistory.refunds[]` for merchant copy
 * (docs/plans/single-source-architecture-audit.plan.md §3.3).
 *
 * ── WHAT IT IS NOT ────────────────────────────────────────────────────
 *
 * MERCHANT-SIDE ONLY. Nothing here is a bank-facing fact: it writes nothing
 * to `pack_json`, and the collector (`orderSource.ts`), `hasRefund`, the
 * fatal-loss gate, the fact classifier and the letters do not read it.
 *
 * FAILS CLOSED ON UNKNOWNS: a pack that never stored `totals.refunded` is
 * `unknown`, never `none`.
 */

import type { I18nToken } from "@/lib/i18n/token";
import { shortEvidenceDate } from "@/lib/argument/deliveryPresentation";

export type RefundKind = "none" | "recorded_no_amount" | "some" | "unknown";

export interface RefundStatement {
  kind: RefundKind;
  /** Decimal string as the pack stores it ("220.0"); only for `some`. */
  amount?: string;
  currency?: string;
  /** Date of the latest refund entry with a positive amount; `some` only. */
  refundedAt?: string;
  /** When the pack was collected (ISO), or null when the caller has no date. */
  asOf: string | null;
}

type Section = { labelToken?: { key?: unknown } | null; data?: unknown } | null | undefined;

const NS = "disputes.refundStatement";

/** Numeric zero test: "0", "0.0" and "0.00" are all zero. Unparseable or
 *  absent values are NOT zero (they are unknown). */
export function isZeroAmount(v: unknown): boolean {
  const n = toNumber(v);
  return n !== null && n === 0;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * The statement read from a persisted pack's sections. Null when the pack has
 * neither an order section nor a refund section (queued, building or failed):
 * nothing is known, and nothing is said.
 */
export function refundStatementFromPackSections(
  sections: unknown,
  asOf: string | null = null,
): RefundStatement | null {
  if (!Array.isArray(sections)) return null;
  const list = sections as Section[];

  const orderData = asRecord(list.find((s) => s?.labelToken?.key === "packs.section.order")?.data);
  const refundData = asRecord(list.find((s) => s?.labelToken?.key === "packs.section.refundHistory")?.data);
  if (!orderData && !refundData) return null;

  const totals = asRecord(orderData?.totals);
  const storedTotal = toNumber(totals?.refunded);
  const currencyOf = (): string | undefined => {
    const c = refundData?.currency ?? totals?.currency;
    return typeof c === "string" && c.trim() ? c.trim() : undefined;
  };

  // A refund section without a refunds[] array is an older shape: it says a
  // refund record exists but not what is in it.
  // A stored order total above zero is a refund on record whatever shape the
  // refund section has, so the legacy-shape short-circuit never hides it.
  if (refundData && !Array.isArray(refundData.refunds)) {
    if (storedTotal !== null && storedTotal > 0) {
      return someStatement(String(totals?.refunded), currencyOf(), null, asOf);
    }
    return { kind: "unknown", asOf };
  }

  const entries = (Array.isArray(refundData?.refunds) ? (refundData.refunds as unknown[]) : [])
    .map(asRecord)
    .filter((e): e is Record<string, unknown> => e !== null);

  const positive = entries.filter((e) => (toNumber(e.amount) ?? 0) > 0);
  // The order total is the authority; the refund section's own total backs it
  // up when the order section did not store one.
  const total = storedTotal ?? (entries.length > 0 ? toNumber(refundData?.amount) : null);
  const positiveSum = positive.reduce((sum, e) => sum + (toNumber(e.amount) ?? 0), 0);

  if (entries.length === 0) {
    if (storedTotal === null) return { kind: "unknown", asOf };
    if (storedTotal === 0) return { kind: "none", asOf };
    return someStatement(String(totals?.refunded), currencyOf(), null, asOf);
  }

  if (total === null && positiveSum === 0) return { kind: "unknown", asOf };
  if ((total ?? 0) > 0 || positiveSum > 0) {
    const amount = (total ?? 0) > 0 ? String(storedTotal !== null ? totals?.refunded : refundData?.amount) : String(positiveSum);
    const latest = positive
      .map((e) => (typeof e.createdAt === "string" ? e.createdAt : null))
      .filter((d): d is string => d !== null && Number.isFinite(Date.parse(d)))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    return someStatement(amount, currencyOf(), latest ?? null, asOf);
  }
  return { kind: "recorded_no_amount", asOf };
}

function someStatement(
  amount: string,
  currency: string | undefined,
  refundedAt: string | null,
  asOf: string | null,
): RefundStatement {
  return {
    kind: "some",
    amount,
    ...(currency ? { currency } : {}),
    ...(refundedAt ? { refundedAt } : {}),
    asOf,
  };
}

const KIND_KEY: Record<RefundKind, string> = {
  none: "none",
  recorded_no_amount: "recordedNoAmount",
  some: "some",
  unknown: "unknown",
};

/** Title and detail tokens for a statement. Dates use the shared short form
 *  ("Jun 12"); a missing date selects the `detailNoDate` variant so a
 *  sentence never carries an empty placeholder. */
export function refundStatementTokens(stmt: RefundStatement): { title: I18nToken; detail: I18nToken } {
  const base = `${NS}.${KIND_KEY[stmt.kind]}`;
  const title: I18nToken = { key: `${base}.title` };
  if (stmt.kind === "unknown") return { title, detail: { key: `${base}.detail` } };

  if (stmt.kind === "some") {
    const amount = [stmt.amount, stmt.currency].filter(Boolean).join(" ");
    const date = shortEvidenceDate(stmt.refundedAt);
    return {
      title,
      detail: date
        ? { key: `${base}.detail`, params: { amount, date } }
        : { key: `${base}.detailNoDate`, params: { amount } },
    };
  }

  const date = shortEvidenceDate(stmt.asOf);
  return {
    title,
    detail: date ? { key: `${base}.detail`, params: { date } } : { key: `${base}.detailNoDate` },
  };
}

/** The statement used when a consumer has none (e.g. a surface that was not
 *  handed the pack): says only that nothing is recorded. */
export const UNKNOWN_REFUND_STATEMENT: RefundStatement = { kind: "unknown", asOf: null };
