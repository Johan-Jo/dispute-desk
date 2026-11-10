/**
 * Scrub a captured workspace payload so it can be committed.
 *
 * Replaces, with stable placeholders: person names, emails, street addresses,
 * phone numbers, IPs, order numbers, shop domains, Shopify GIDs and shop UUIDs.
 * `findLeaks` re-scans the scrubbed text and the capture fails if anything it
 * knows to be sensitive survived. The PR diff is still reviewed by a human.
 */

const PERSON_KEYS = new Set([
  "customerName", "cardholderName", "customer_name", "cardholder_name",
  "customerFirstName", "customerLastName", "firstName", "lastName", "first_name", "last_name",
]);
const ADDRESS_KEYS = new Set([
  "address1", "address2", "addressLine1", "addressLine2", "address_line1", "address_line2",
  "street", "city", "zip", "postalCode", "postal_code", "postcode", "province", "phone",
  "company", "billingAddress", "shippingAddress", "billing_address", "shipping_address",
]);
const EMAIL_KEYS = new Set(["email", "customerEmail", "customer_email"]);
const ORDER_KEYS = new Set(["orderName", "order_name", "orderNumber", "order_number"]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_RE = /\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi;
const GID_RE = /gid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+(?:\?[^\s"']*)?/g;
const MYSHOPIFY_RE = /[a-z0-9][a-z0-9-]*\.myshopify\.com/gi;
const SHOP_PATH_RE = /admin\.shopify\.com\/store\/[a-z0-9-]+/gi;
const PHONE_RE = /(?<![\w.])\+\d[\d\s().-]{7,}\d/g;

function strings(node: unknown, visit: (key: string | null, v: string, underKeys: string[]) => void, key: string | null = null, under: string[] = []): void {
  if (typeof node === "string") visit(key, node, under);
  else if (Array.isArray(node)) for (const x of node) strings(x, visit, key, under);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) strings(v, visit, k, under.concat(k));
  }
}

export interface ScrubResult {
  json: unknown;
  /** Sensitive literals that were replaced (kept in memory for the leak check only). */
  literals: string[];
}

export function scrubFixture(input: unknown, knownDomains: string[] = []): ScrubResult {
  const people = new Map<string, string>();
  const addresses = new Map<string, string>();
  const orders = new Map<string, string>();
  const domains = new Map<string, string>();
  const tracking = new Map<string, string>();

  const add = (m: Map<string, string>, v: string, make: (n: number) => string) => {
    const t = v.trim();
    if (t.length < 3 || m.has(t)) return;
    m.set(t, make(m.size + 1));
  };

  strings(input, (key, v, under) => {
    if (key && PERSON_KEYS.has(key)) {
      add(people, v, (n) => `Customer ${n}`);
      for (const part of v.trim().split(/\s+/)) if (part.length >= 3) add(people, part, (n) => `Name${n}`);
    } else if (key && (key === "trackingNumber" || key === "tracking_number" || (key === "number" && under.some((k) => /tracking/i.test(k))))) {
      add(tracking, v, (n) => `TRK${String(n).padStart(6, "0")}`);
    } else if (key && ORDER_KEYS.has(key)) {
      add(orders, v.replace(/^#/, ""), (n) => String(1000 + n));
    } else if (key && (ADDRESS_KEYS.has(key) || under.some((k) => ADDRESS_KEYS.has(k)))) {
      if (!/^[A-Z]{2}$/.test(v)) add(addresses, v, (n) => `Address ${n}`);
      // Street names also appear without the house number; scrub the name on its own.
      if (/^(address[12]|addressLine[12]|address_line[12]|street)$/.test(key ?? "")) {
        for (const part of v.split(/[\s,]+/)) if (/^\p{L}{5,}$/u.test(part)) add(addresses, part, (n) => `Address ${n}`);
      }
    }
    void EMAIL_KEYS;
  });
  for (const d of knownDomains) add(domains, d, (n) => `shop-${n}.example.test`);

  const shopUuids = new Map<string, string>();
  const uuidOf = (s: string) => {
    if (!shopUuids.has(s)) shopUuids.set(s, `00000000-0000-4000-8000-${String(shopUuids.size + 1).padStart(12, "0")}`);
    return shopUuids.get(s) as string;
  };

  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const replaceMap = (text: string, m: Map<string, string>, wordish: boolean): string => {
    const keys = [...m.keys()].sort((a, b) => b.length - a.length);
    let out = text;
    for (const k of keys) {
      const re = wordish ? new RegExp(`(?<![\\w])${esc(k)}(?![\\w])`, "gi") : new RegExp(esc(k), "gi");
      out = out.replace(re, m.get(k) as string);
    }
    return out;
  };

  const shopIds = new Set<string>();
  if (input && typeof input === "object") {
    strings(input, (key, v) => {
      if (key && (key === "shop_id" || key === "shopId") && /^[0-9a-f-]{36}$/i.test(v)) shopIds.add(v);
    });
  }

  // Scrub string VALUES, never the serialized text: a replacement must not be able to split a JSON escape.
  const scrubString = (v: string): string => {
    let text = v;
    text = replaceMap(text, domains, false);
    text = text.replace(GID_RE, "gid://shopify/Scrubbed/1");
    text = text.replace(SHOP_PATH_RE, "admin.shopify.com/store/scrubbed-shop");
    text = text.replace(MYSHOPIFY_RE, "scrubbed-shop.myshopify.com");
    text = text.replace(EMAIL_RE, "customer@example.test");
    text = text.replace(IPV4_RE, "203.0.113.1");
    text = text.replace(IPV6_RE, "2001:db8::1");
    text = text.replace(PHONE_RE, "+10000000000");
    text = replaceMap(text, tracking, false);
    text = replaceMap(text, people, true);
    text = replaceMap(text, addresses, true);
    for (const [name, repl] of orders) {
      text = text.replace(new RegExp("(?<![\\d.,])" + esc(name) + "(?![\\d])", "g"), repl);
    }
    for (const id of shopIds) text = text.split(id).join(uuidOf(id));
    return text;
  };
  const mapStrings = (node: unknown): unknown => {
    if (typeof node === "string") return scrubString(node);
    if (Array.isArray(node)) return node.map(mapStrings);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [scrubString(k), mapStrings(v)]));
    }
    return node;
  };
  const parsed = mapStrings(input);

  return {
    json: parsed,
    literals: [...tracking.keys(), ...people.keys(), ...addresses.keys(), ...orders.keys(), ...domains.keys(), ...shopIds],
  };
}

/** What a scrubbed fixture still contains that must not be committed. */
export function findLeaks(scrubbedText: string, literals: string[]): string[] {
  const leaks: string[] = [];
  const hit = (label: string, re: RegExp) => {
    for (const m of scrubbedText.match(re) ?? []) {
      if (label === "email" && m.endsWith("customer@example.test")) continue;
      if (label === "ipv4" && m === "203.0.113.1") continue;
      if (label === "ipv6" && m === "2001:db8::1") continue;
      if (label === "myshopify" && m === "scrubbed-shop.myshopify.com") continue;
      leaks.push(`${label}: ${m}`);
    }
  };
  hit("email", EMAIL_RE);
  hit("ipv4", IPV4_RE);
  hit("ipv6", IPV6_RE);
  hit("myshopify", MYSHOPIFY_RE);
  for (const gid of scrubbedText.match(GID_RE) ?? []) {
    if (gid !== "gid://shopify/Scrubbed/1") leaks.push(`gid: ${gid}`);
  }
  for (const l of literals) {
    if (l.length < 4) continue;
    const escaped = l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("(?<![\\w])" + escaped + "(?![\\w])", "i");
    if (re.test(scrubbedText)) leaks.push(`literal: ${l}`);
  }
  return leaks;
}
