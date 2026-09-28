/**
 * The product-listing exhibit for the defence PDF (not-as-described plan
 * PR 3b). One entry per collected line item, built from the pack's
 * product-listing section, with images read from storage.
 *
 * Printed only when the letter's facts include a collected, bank-included
 * listing — so a pack built with the collector OFF (no section) or a listing
 * the plan did not choose prints nothing.
 *
 * Caption rule (plan §1, C2): "Product listing as published in the store,
 * retrieved {date}" is a fact; anything implying it is what the customer saw
 * at checkout, or that it "may differ", is not written.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRODUCT_LISTING_BUCKET } from "@/lib/packs/productListingStorage";

export interface ProductListingExhibit {
  title: string | null;
  /** "Colour: Stone grey · Size: 40 × 40 cm" */
  variantLine: string | null;
  excerpt: string | null;
  sourceUrl: string | null;
  /** Shortened link text for `sourceUrl`. */
  sourceUrlDisplay: string | null;
  /** YYYY-MM-DD, the retrieval date the caption states. */
  retrievedOn: string | null;
  /** data: URIs (JPEG/PNG only — the PDF renderer reads nothing else). */
  images: string[];
}

export const EXHIBIT_LIMITS = {
  imagesPerPdf: 6,
  /** Total image bytes per PDF; the PDF must stay under Shopify's 2 MB. */
  imageBytesPerPdf: 900_000,
} as const;

interface SectionLike {
  source?: string;
  data?: Record<string, unknown> | null;
}

type Listing = {
  title?: unknown;
  variantOptions?: unknown;
  variantTitle?: unknown;
  excerpt?: unknown;
  sourceUrl?: unknown;
  fetchedAt?: unknown;
  imagePaths?: unknown;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Only what the PDF font can draw. Store descriptions carry emoji and
 * pictographs, which the renderer printed as garbage ("=Ì", prod canary
 * #100411). Removed, then whitespace collapsed.
 */
export function printable(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const clean = s
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E000}-\u{F8FF}]/gu, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || null;
}

/** The link text: host + path, shortened — a full product URL ran off the
 *  page. The link target stays the full URL. */
export function displayUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const text = `${u.host}${u.pathname}`;
    return text.length > 70 ? `${text.slice(0, 69)}…` : text;
  } catch {
    return url.length > 70 ? `${url.slice(0, 69)}…` : url;
  }
}

function variantLine(l: Listing): string | null {
  const opts = Array.isArray(l.variantOptions)
    ? (l.variantOptions as Array<{ name?: unknown; value?: unknown }>)
        // "Title" is Shopify's name for the single implicit option — never
        // a real one (prod canary #100411 printed "Title: *3.95").
        .filter((o) => !/^title$/i.test(String(o.name ?? "").trim()))
        .map((o) => (printable(o.name) && printable(o.value) ? `${printable(o.name)}: ${printable(o.value)}` : null))
        .filter((x): x is string => !!x && !/default title/i.test(x))
    : [];
  if (opts.length) return opts.join(" · ");
  const t = printable(l.variantTitle);
  return t && !/^Default Title$/i.test(t) ? t : null;
}

function mimeFor(path: string, bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return /\.jpe?g$/i.test(path) ? "image/jpeg" : /\.png$/i.test(path) ? "image/png" : null;
}

export async function buildProductListingExhibits(args: {
  sb: SupabaseClient;
  sections: readonly SectionLike[];
  /** The letter cites a collected listing (the fact made the plan's cut). */
  listingCited: boolean;
  download?: (path: string) => Promise<Uint8Array | null>;
}): Promise<ProductListingExhibit[]> {
  if (!args.listingCited) return [];
  const section = args.sections.find((s) => s.source === "shopify_product");
  const listings = Array.isArray(section?.data?.listings) ? (section!.data!.listings as Listing[]) : [];
  if (listings.length === 0) return [];

  const download =
    args.download ??
    (async (path: string) => {
      const { data, error } = await args.sb.storage.from(PRODUCT_LISTING_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    });

  let imageCount = 0;
  let imageBytes = 0;
  const seen = new Set<string>();
  const exhibits: ProductListingExhibit[] = [];
  for (const l of listings) {
    const images: string[] = [];
    for (const path of Array.isArray(l.imagePaths) ? (l.imagePaths as unknown[]) : []) {
      if (typeof path !== "string" || seen.has(path)) continue; // content-addressed: same path = same image
      if (imageCount >= EXHIBIT_LIMITS.imagesPerPdf) break;
      seen.add(path);
      const bytes = await download(path).catch(() => null);
      if (!bytes) continue;
      const mime = mimeFor(path, bytes);
      if (!mime) continue;
      if (imageBytes + bytes.length > EXHIBIT_LIMITS.imageBytesPerPdf) continue;
      imageBytes += bytes.length;
      imageCount += 1;
      images.push(`data:${mime};base64,${Buffer.from(bytes).toString("base64")}`);
    }
    const fetched = str(l.fetchedAt);
    exhibits.push({
      title: printable(l.title),
      variantLine: variantLine(l),
      excerpt: printable(l.excerpt),
      sourceUrl: str(l.sourceUrl),
      sourceUrlDisplay: displayUrl(str(l.sourceUrl)),
      retrievedOn: fetched ? fetched.slice(0, 10) : null,
      images,
    });
  }
  return exhibits;
}

/** The exhibit caption — a fact about provenance, never a hedge (C2). */
export function exhibitCaption(retrievedOn: string | null): string {
  return retrievedOn
    ? `Product listing as published in the store, retrieved ${retrievedOn}`
    : "Product listing as published in the store";
}
