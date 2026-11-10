/**
 * Merchant de-identification for committed fixtures: brand names -> "Merchant X",
 * product / variant titles -> "Product n", policy text previews -> a same-length
 * placeholder. Runs after the customer-data scrub. `findMerchantLeaks` is the net.
 */

export const MERCHANT_BRANDS: Array<{ label: string; names: string[] }> = [
  { label: "Merchant A", names: ["Cay Collective", "Alfredssons.com", "Alfredssons", "cay-collective"] },
  { label: "Merchant B", names: ["Hem & Trend", "Hem &amp; Trend", "hem-trend", "hemtrend"] },
  { label: "Merchant C", names: ["Mein Maison", "meinmaison", "mein-maison", "Uvives", "LumoBeam"] },
  { label: "Merchant D", names: ["meetblume.com", "blume.com", "blume-box", "Blume"] },
];

const TITLE_KEYS = new Set(["title", "variantTitle", "productTitle", "variant_title", "product_title"]);
const PRODUCT_PATH = /lineItems|line_items|items|products?|fulfillments/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function placeholder(len: number): string {
  const unit = "Policy text placeholder. ";
  let out = "";
  while (out.length < len) out += unit;
  return out.slice(0, Math.max(0, len));
}

export function scrubMerchant(input: unknown, extraBrands: string[] = []): unknown {
  const titles = new Map<string, string>();
  const collect = (node: unknown, under: string[]): void => {
    if (Array.isArray(node)) node.forEach((x) => collect(x, under));
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (typeof v === "string" && TITLE_KEYS.has(k) && under.some((u) => PRODUCT_PATH.test(u)) && v.trim() && !titles.has(v)) {
          titles.set(v, `Product ${titles.size + 1}`);
        }
        collect(v, under.concat(k));
      }
    }
  };
  collect(input, []);

  const pairs: Array<[RegExp, string]> = [];
  for (const g of MERCHANT_BRANDS) for (const n of g.names) pairs.push([new RegExp(esc(n), "gi"), g.label]);
  for (const b of extraBrands) if (b.length >= 4) pairs.push([new RegExp(esc(b), "gi"), "Merchant X"]);
  pairs.sort((a, b) => b[0].source.length - a[0].source.length);
  const titleList = [...titles.keys()].sort((a, b) => b.length - a.length);

  const text = (s: string): string => {
    let out = s;
    for (const t of titleList) out = out.split(t).join(titles.get(t) as string);
    for (const [re, label] of pairs) out = out.replace(re, label);
    return out;
  };
  const walk = (node: unknown, key: string | null): unknown => {
    if (typeof node === "string") {
      if (key === "textPreview") return placeholder(node.length);
      if (key === "excerpt") return placeholder(node.length).replace("Policy text", "Product text");
      if (key === "sourceUrl") return node.replace(/\/products\/[^?#\s]*/i, "/products/product");
      return text(node);
    }
    if (Array.isArray(node)) return node.map((x) => walk(x, key));
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    }
    return node;
  };
  return walk(input, null);
}

/** Brand names and shop handles that must not survive in a committed fixture. */
export function findMerchantLeaks(scrubbedText: string): string[] {
  const leaks: string[] = [];
  for (const g of MERCHANT_BRANDS) {
    for (const n of g.names) if (new RegExp(esc(n), "i").test(scrubbedText)) leaks.push(`brand: ${n}`);
  }
  for (const m of scrubbedText.match(/[a-z0-9-]*myshopify[a-z0-9.-]*/gi) ?? []) {
    if (m !== "scrubbed-shop.myshopify.com") leaks.push(`myshopify: ${m}`);
  }
  return leaks;
}
