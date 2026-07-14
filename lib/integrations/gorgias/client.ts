/**
 * Gorgias REST API client (read-only).
 *
 * Phase 1 — private app, HTTP Basic auth (email + API key). Used by the
 * evidence collector to pull a customer's helpdesk conversations at
 * pack-build time.
 *
 * Auth model mirrors the existing connect/test routes:
 *   base   = https://{subdomain}.gorgias.com
 *   header = Authorization: Basic base64(email:apiKey)
 *
 * Design notes:
 *   - Cursor pagination (offset/page was deprecated by Gorgias). Each
 *     list call is bounded by `maxPages` so a chatty customer cannot make
 *     a single pack build fan out unbounded requests.
 *   - The 40 req/20s API-key rate limit is tight, so the collector
 *     prefers the embedded `messages[]` array already present on each
 *     ticket; `listTicketMessages` is only the fallback.
 *   - 429 (and transient 5xx) are retried a bounded number of times,
 *     honouring `Retry-After`. JSON is parsed defensively — Gorgias
 *     fields are frequently null and the channel set is open-ended.
 *   - Callers treat the client as best-effort: hard failures throw and
 *     the collector swallows them (see gorgiasCommSource.ts).
 */

export interface GorgiasCredentials {
  subdomain: string;
  email: string;
  apiKey: string;
}

export interface GorgiasCustomer {
  id: number;
  email: string | null;
  name?: string | null;
}

export interface GorgiasMessageSource {
  type?: string | null;
  from?: { name?: string | null; address?: string | null } | null;
}

export interface GorgiasMessage {
  id: number;
  /** Public-facing message vs internal agent note. We only ever emit
   *  public === true (an internal note could be a self-incriminating
   *  confession in a chargeback). */
  public: boolean;
  /** Open string set: email, chat, sms, phone, internal-note, ... */
  channel: string | null;
  /** true = outbound (merchant→customer); false = inbound. */
  from_agent: boolean;
  /** Clean single-message text (signatures + quoted replies removed). */
  stripped_text: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_datetime: string | null;
  created_datetime: string | null;
  source?: GorgiasMessageSource | null;
}

export interface GorgiasSatisfactionSurvey {
  score: number | null;
  body_text?: string | null;
  scored_datetime?: string | null;
}

export interface GorgiasTicketCustomer {
  id?: number | null;
  email?: string | null;
  name?: string | null;
  /** Integration payloads (e.g. Shopify) Gorgias attaches to the customer.
   *  Shape is account-specific and undocumented — always read defensively. */
  integrations?: Record<string, unknown> | null;
  data?: Record<string, unknown> | null;
}

export interface GorgiasTicket {
  id: number;
  /** Gorgias status enum is only "open" | "closed". */
  status: string | null;
  channel: string | null;
  spam: boolean;
  subject?: string | null;
  customer?: GorgiasTicketCustomer | null;
  /** Free-form integration/app metadata on the ticket. Undocumented shape. */
  meta?: Record<string, unknown> | null;
  /** Soft-delete marker. Non-null = trashed; excluded from evidence. */
  trashed_datetime: string | null;
  created_datetime: string | null;
  updated_datetime: string | null;
  /** Embedded on the ticket object; preferred over a per-ticket
   *  messages call to stay under the rate limit. */
  messages?: GorgiasMessage[] | null;
  satisfaction_survey?: GorgiasSatisfactionSurvey | null;
}

/**
 * Best-effort extraction of a linked Shopify order name ("#1066") from the
 * undocumented Gorgias↔Shopify integration payloads on a ticket/customer.
 * Only present when the merchant runs Gorgias's own Shopify integration;
 * returns null whenever the shape doesn't cooperate (the match engine
 * reaches high confidence without this signal).
 */
export function extractLinkedShopifyOrderName(
  ticket: GorgiasTicket,
): string | null {
  const candidates: unknown[] = [ticket.meta, ticket.customer?.integrations, ticket.customer?.data];
  for (const root of candidates) {
    const found = findOrderNameDeep(root, 0);
    if (found) return found;
  }
  return null;
}

const ORDER_NAME_KEYS = new Set(["order_name", "orderName", "name", "order_number", "orderNumber"]);

function findOrderNameDeep(node: unknown, depth: number): string | null {
  if (depth > 4 || node === null || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  // Only trust name-like keys that live under an order-ish parent — handled
  // by recursing into keys containing "order"/"shopify" and checking leaves.
  for (const [key, value] of Object.entries(obj)) {
    const keyLower = key.toLowerCase();
    if (
      ORDER_NAME_KEYS.has(key) &&
      typeof value === "string" &&
      /^#?\d{3,}$/.test(value.trim())
    ) {
      // Bare "name" only counts when the parent chain was order-scoped —
      // enforced by only recursing into order/shopify branches below.
      if (key === "name" || key === "order_number" || key === "orderNumber") {
        if (depth === 0) continue; // never trust top-level generic keys
      }
      return value.trim().startsWith("#") ? value.trim() : `#${value.trim()}`;
    }
    if (
      (keyLower.includes("order") || keyLower.includes("shopify")) &&
      typeof value === "object" &&
      value !== null
    ) {
      const arr = Array.isArray(value) ? value : [value];
      for (const item of arr) {
        const found = findOrderNameDeep(item, depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

export interface GorgiasClient {
  resolveCustomerByEmail(email: string): Promise<GorgiasCustomer | null>;
  listCustomerTickets(customerId: number): Promise<GorgiasTicket[]>;
  listTicketMessages(ticketId: number): Promise<GorgiasMessage[]>;
}

type FetchLike = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

interface ClientOptions {
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Injectable for tests so retry backoff is instant. */
  sleepImpl?: SleepFn;
  /** Safety cap on cursor pages per list call. */
  maxPages?: number;
  /** Page size (Gorgias max is 100). */
  pageLimit?: number;
}

interface GorgiasListResponse<T> {
  data?: T[] | null;
  meta?: { next_cursor?: string | null } | null;
}

const DEFAULT_MAX_PAGES = 10;
const DEFAULT_PAGE_LIMIT = 30;
const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 5_000;

const realSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createGorgiasClient(
  creds: GorgiasCredentials,
  opts: ClientOptions = {},
): GorgiasClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepImpl ?? realSleep;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const pageLimit = opts.pageLimit ?? DEFAULT_PAGE_LIMIT;

  const base = `https://${creds.subdomain}.gorgias.com`;
  const authHeader = `Basic ${Buffer.from(
    `${creds.email}:${creds.apiKey}`,
  ).toString("base64")}`;

  async function gorgiasGet<T>(path: string): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(`${base}${path}`, {
          headers: { Authorization: authHeader, Accept: "application/json" },
        });
      } catch (e) {
        lastError = e;
        if (attempt === MAX_RETRIES) throw e;
        await sleep(backoffMs(attempt, null));
        continue;
      }

      if (res.ok) {
        return (await res.json()) as T;
      }

      // Retry on rate limit + transient server errors only.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
        await sleep(backoffMs(attempt, retryAfter));
        continue;
      }

      throw new Error(`Gorgias API ${res.status} on ${path}`);
    }
    // Unreachable, but satisfies the type checker.
    throw lastError instanceof Error
      ? lastError
      : new Error(`Gorgias request failed: ${path}`);
  }

  async function paginate<T>(buildPath: (cursor: string | null) => string): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const body: GorgiasListResponse<T> = await gorgiasGet(buildPath(cursor));
      const rows = Array.isArray(body?.data) ? body.data : [];
      out.push(...rows);
      const next = body?.meta?.next_cursor ?? null;
      if (!next || rows.length === 0) break;
      cursor = next;
    }
    return out;
  }

  return {
    async resolveCustomerByEmail(email) {
      const trimmed = email.trim();
      if (!trimmed) return null;
      const body = await gorgiasGet<GorgiasListResponse<GorgiasCustomer>>(
        `/api/customers?email=${encodeURIComponent(trimmed)}`,
      );
      const rows = Array.isArray(body?.data) ? body.data : [];
      // The ?email= filter's match strictness is undocumented, so verify
      // the address ourselves (case-insensitive exact match).
      const match = rows.find(
        (c) => (c.email ?? "").trim().toLowerCase() === trimmed.toLowerCase(),
      );
      return match ?? null;
    },

    async listCustomerTickets(customerId) {
      return paginate<GorgiasTicket>((cursor) => {
        const params = new URLSearchParams({
          customer_id: String(customerId),
          order_by: "updated_datetime:desc",
          trashed: "false",
          limit: String(pageLimit),
        });
        if (cursor) params.set("cursor", cursor);
        return `/api/tickets?${params.toString()}`;
      });
    },

    async listTicketMessages(ticketId) {
      return paginate<GorgiasMessage>((cursor) => {
        const params = new URLSearchParams({
          ticket_id: String(ticketId),
          limit: String(pageLimit),
        });
        if (cursor) params.set("cursor", cursor);
        return `/api/messages?${params.toString()}`;
      });
    },
  };
}

function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null;
  const secs = Number(raw);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : null;
}

function backoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs != null) return Math.min(retryAfterMs, MAX_BACKOFF_MS);
  return Math.min(2 ** attempt * 500, MAX_BACKOFF_MS);
}
