/**
 * Order-context derivation from a pack's `pack_json.sections`.
 *
 * Single source of truth for the case-details rows the PDF renderer
 * AND the embedded HTML mirror display under "Case Details". Before
 * 2026-05-16 the build job hardcoded these fields to `null`, leaving 8
 * of 12 PDF rows showing "—" even though the data sat in `pack_json`.
 *
 * Read-only — no Shopify calls, no DB queries. Just walk the persisted
 * section payloads the collectors already wrote.
 */
import type { PackSectionLike } from "./factClassifier";

export interface OrderContext {
  orderName: string | null;
  transactionDate: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  cardholderName: string | null;
  customerEmail: string | null;
  cardNetwork: string | null;
  cardLast4: string | null;
  paymentGateway: string | null;
  lineItems: Array<{ description: string; quantity: number; price: string }>;
  timelineEvents: Array<{ at: string; text: string }>;
  priorOrderCount: number | null;
  isRepeatCustomer: boolean | null;
}

const EMPTY: OrderContext = {
  orderName: null,
  transactionDate: null,
  financialStatus: null,
  fulfillmentStatus: null,
  cardholderName: null,
  customerEmail: null,
  cardNetwork: null,
  cardLast4: null,
  paymentGateway: null,
  lineItems: [],
  timelineEvents: [],
  priorOrderCount: null,
  isRepeatCustomer: null,
};

function pickString(data: Record<string, unknown> | undefined, key: string): string | null {
  if (!data) return null;
  const v = data[key];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickNumber(data: Record<string, unknown> | undefined, key: string): number | null {
  if (!data) return null;
  const v = data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pickBoolean(data: Record<string, unknown> | undefined, key: string): boolean | null {
  if (!data) return null;
  const v = data[key];
  return typeof v === "boolean" ? v : null;
}

/** Pack collector emits "shopify_payments"; display as "Shopify Payments". */
function formatGateway(raw: string | null): string | null {
  if (!raw) return null;
  if (raw === "shopify_payments") return "Shopify Payments";
  return raw
    .split("_")
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join(" ");
}

/** "•••• •••• •••• 0259" or "0259" → "0259". */
function extractLast4(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})\s*$/);
  return m ? m[1] : null;
}

/**
 * Strip HTML tags + decode common entities. Shopify's timeline event
 * `message` strings occasionally embed anchor tags ("Received new
 * order <a href=...>#1077</a> by ...") — rendering them verbatim in a
 * bank-facing PDF leaks markup.
 */
function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map a pack `lineItems[i]` entry (collector shape) to the PDF row
 * shape `{ description, quantity, price }`. Returns null when the
 * entry lacks the fields the table needs.
 */
function mapLineItem(raw: unknown): { description: string; quantity: number; price: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title : typeof o.description === "string" ? o.description : null;
  const variant = typeof o.variant === "string" ? o.variant : null;
  const quantity = typeof o.quantity === "number" ? o.quantity : null;
  const totalRaw = typeof o.total === "string" ? o.total : typeof o.price === "string" ? o.price : null;
  const currency = typeof o.currency === "string" ? o.currency : null;
  if (!title || quantity == null || !totalRaw) return null;
  const description = variant ? `${title} — ${variant}` : title;
  const price = currency ? `${currency} ${totalRaw}` : totalRaw;
  return { description, quantity, price };
}

/**
 * Walk `pack_json.sections` once and produce the order-context payload
 * the PDF renderer + workspace API both consume. Sections we read:
 *
 *   - type=order (source=shopify_order)            → order fields, line items
 *   - source=shopify_transactions                  → card network, last 4,
 *                                                    cardholder, gateway
 *   - type=access_log                              → timeline events
 *   - source=shopify_order with totalOrders        → prior order count
 */
export function deriveOrderContext(sections: PackSectionLike[] | null | undefined): OrderContext {
  if (!Array.isArray(sections) || sections.length === 0) return { ...EMPTY };

  const ctx: OrderContext = { ...EMPTY };

  for (const section of sections) {
    const data = section?.data as Record<string, unknown> | undefined;
    if (!data) continue;

    if (section.type === "order") {
      ctx.orderName ??= pickString(data, "orderName");
      ctx.transactionDate ??= pickString(data, "createdAt");
      ctx.financialStatus ??= pickString(data, "financialStatus");
      ctx.fulfillmentStatus ??= pickString(data, "fulfillmentStatus");
      // billingAddress.name is the most authoritative cardholder name when
      // present; the payment section is the fallback.
      const billing = data.billingAddress as Record<string, unknown> | undefined;
      const billingName = pickString(billing, "name");
      if (billingName) ctx.cardholderName ??= billingName;
      // line items
      const rawItems = data.lineItems;
      if (Array.isArray(rawItems) && ctx.lineItems.length === 0) {
        ctx.lineItems = rawItems
          .map(mapLineItem)
          .filter((it): it is { description: string; quantity: number; price: string } => it !== null);
      }
      continue;
    }

    if (section.source === "shopify_transactions") {
      ctx.cardNetwork ??= pickString(data, "cardCompany");
      ctx.cardholderName ??= pickString(data, "cardholderName");
      ctx.cardLast4 ??= extractLast4(pickString(data, "lastFour"));
      ctx.paymentGateway ??= formatGateway(pickString(data, "gateway"));
      continue;
    }

    if (section.type === "access_log") {
      const events = data.timelineEvents;
      if (Array.isArray(events) && ctx.timelineEvents.length === 0) {
        ctx.timelineEvents = events
          .map((e) => {
            if (!e || typeof e !== "object") return null;
            const o = e as Record<string, unknown>;
            const at = typeof o.createdAt === "string" ? o.createdAt : null;
            const text = typeof o.message === "string" ? o.message : null;
            if (!at || !text) return null;
            return { at, text: stripHtml(text) };
          })
          .filter((e): e is { at: string; text: string } => e !== null);
      }
      continue;
    }

    // Customer account section — totalOrders + isRepeatCustomer live on
    // a `type=other` section under `source=shopify_order`.
    if ("totalOrders" in data || "isRepeatCustomer" in data) {
      ctx.priorOrderCount ??= pickNumber(data, "totalOrders");
      ctx.isRepeatCustomer ??= pickBoolean(data, "isRepeatCustomer");
    }
  }

  return ctx;
}

/**
 * Friendly merchant display name derived from the Shopify domain when
 * no stored shop name is available. `surasvenne.myshopify.com` →
 * `Surasvenne`. Returns null when the domain isn't a recognisable
 * `.myshopify.com` host.
 */
export function merchantNameFromDomain(shopDomain: string | null): string | null {
  if (!shopDomain) return null;
  const m = shopDomain.match(/^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/i);
  if (!m) return null;
  const slug = m[1];
  return slug
    .split("-")
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join(" ");
}
