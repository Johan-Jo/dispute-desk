import "server-only";

import { getServiceClient } from "@/lib/supabase/server";
import { estimateReadingTimeMinutes } from "@/lib/resources/readingTime";
import { routeKindForContentType } from "./contentRouteKind";

/**
 * Translate a content_item's PUBLISHED en-US source into the other hub locales via
 * the DeepL API and publish each. This is the non-English half of the English-first
 * autopilot: Claude writes only English (one generation), DeepL produces every
 * other language — far cheaper and immune to the structured-output truncation /
 * native-translation drift that native multi-locale Claude generation produced.
 *
 * Terminology is locked with a SENTINEL SWAP: the English domain term "chargeback"
 * is replaced with an opaque token before translation and restored to the
 * established per-locale term after — so DeepL can never render it as a "refund"
 * word, and legitimate refund wording in the article is left untouched. Term map
 * matches messages/*.json UI convention (sv keeps the loanword).
 */

const DEEPL_LANG: Record<string, string> = {
  "sv-SE": "SV", "de-DE": "DE", "fr-FR": "FR", "es-ES": "ES", "pt-BR": "PT-BR",
};

/** Established per-locale term for "chargeback" {singular, plural}. Matches messages/*.json. */
const CHARGEBACK_TERM: Record<string, { s: string; p: string }> = {
  "sv-SE": { s: "chargeback", p: "chargebacks" },
  "de-DE": { s: "Rückbuchung", p: "Rückbuchungen" },
  "fr-FR": { s: "rétrofacturation", p: "rétrofacturations" },
  "es-ES": { s: "contracargo", p: "contracargos" },
  "pt-BR": { s: "estorno", p: "estornos" },
};

/** Opaque sentinel — must contain NO translatable substring (an earlier token with
 *  "CHARGEBACK" inside was partially translated). Applied to ALL locales (chargeback
 *  is glossary-locked everywhere). */
const subSource = (s: string | null | undefined): string =>
  (s ?? "").replace(/chargebacks/gi, "QZXTERMZZS").replace(/chargeback/gi, "QZXTERMZZ");

/**
 * Industry terms kept as the English loanword for SPECIFIC locales (no established
 * translation; the literal translation reads wrong). Per-locale because the policy
 * differs — e.g. "friendly fraud" stays English in Swedish only (like 'chargeback'),
 * while de/es/fr/pt use their own translation. Each entry: the phrase + an opaque
 * sentinel token (no translatable substring) so DeepL leaves it alone; restored to
 * the English phrase after translation.
 */
const KEEP_ENGLISH_TERMS: Record<string, Array<{ re: RegExp; token: string; english: string }>> = {
  "sv-SE": [
    { re: /friendly fraud/gi, token: "QZXFFTERMZZ", english: "Friendly Fraud" },
  ],
};

function makeRestore(locale: string): (s: string | null | undefined) => string {
  const term = CHARGEBACK_TERM[locale];
  const keep = KEEP_ENGLISH_TERMS[locale] ?? [];
  return (s) => {
    let out = (s ?? "")
      .replace(/qzxtermzzs/gi, term.p)
      .replace(/qzxtermzz/gi, term.s);
    for (const k of keep) out = out.replace(new RegExp(k.token, "gi"), k.english);
    return out;
  };
}

/** Apply the per-locale keep-English sentinel protection on top of the shared chargeback sub. */
function protectForLocale(locale: string, s: string): string {
  const keep = KEEP_ENGLISH_TERMS[locale] ?? [];
  let out = s;
  for (const k of keep) out = out.replace(k.re, k.token);
  return out;
}

const capFirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function deeplHost(key: string): string {
  return key.trim().endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
}

async function deeplTranslate(
  key: string,
  texts: string[],
  targetLang: string,
  html: boolean
): Promise<string[]> {
  if (texts.length === 0) return [];
  const body: Record<string, unknown> = { text: texts, target_lang: targetLang, source_lang: "EN" };
  if (html) body.tag_handling = "html";
  const res = await fetch(`${deeplHost(key)}/v2/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `DeepL-Auth-Key ${key.trim()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DeepL ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (((await res.json()).translations ?? []) as Array<{ text: string }>).map((t) => t.text);
}

function slugify(s: string): string {
  return (s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    .slice(0, 80) || "artikel";
}

const wordCount = (h: string): number =>
  h ? h.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length : 0;

export interface LocaleTranslationOutcome {
  locale: string;
  status: "inserted" | "updated" | "skipped" | "failed";
  words?: number;
  error?: string;
}

export interface TranslateArticleResult {
  contentItemId: string;
  outcomes: LocaleTranslationOutcome[];
}

/**
 * Translate the item's en-US source into every other hub locale (or `opts.locales`)
 * and publish each. Inserts a row when the locale doesn't exist, updates in place
 * when it does (keeping the slug stable). Sentinel-swaps the chargeback term and
 * capitalizes the first letter of translated titles. Idempotent per locale.
 */
export async function translateArticleLocales(
  contentItemId: string,
  opts: { locales?: string[]; publish?: boolean } = {}
): Promise<TranslateArticleResult> {
  const key = process.env.DEEPL_API_KEY;
  const locales = (opts.locales ?? Object.keys(DEEPL_LANG)).filter((l) => DEEPL_LANG[l]);
  const publish = opts.publish !== false; // default true
  const result: TranslateArticleResult = { contentItemId, outcomes: [] };

  if (!key) {
    for (const l of locales) result.outcomes.push({ locale: l, status: "failed", error: "DEEPL_API_KEY not configured" });
    return result;
  }

  const sb = getServiceClient();
  const { data: en } = await sb
    .from("content_localizations")
    .select("title, excerpt, meta_title, meta_description, body_json, route_kind, content_items!inner(content_type)")
    .eq("content_item_id", contentItemId)
    .eq("locale", "en-US")
    .maybeSingle();
  if (!en) {
    for (const l of locales) result.outcomes.push({ locale: l, status: "failed", error: "no en-US source" });
    return result;
  }

  const b = (en.body_json ?? {}) as Record<string, unknown>;
  const routeKind =
    (en.route_kind as string | null) ??
    routeKindForContentType(((en.content_items as { content_type?: string } | null)?.content_type) ?? "cluster_article");

  // Sentinel-protect the English source once.
  const enTitle = subSource(en.title as string), enExcerpt = subSource(en.excerpt as string);
  const enMetaTitle = subSource(en.meta_title as string), enMetaDesc = subSource(en.meta_description as string);
  const enDisclaimer = subSource(b.disclaimer as string);
  const ktSrc = (b.keyTakeaways as string[] | undefined) ?? [];
  const faqSrc = (b.faq as Array<{ q: string; a: string }> | undefined) ?? [];
  const kt = ktSrc.map(subSource);
  const faq = faqSrc.map((f) => ({ q: subSource(f.q), a: subSource(f.a) }));
  const enHtml = subSource(b.mainHtml as string);

  for (const locale of locales) {
    const targetLang = DEEPL_LANG[locale];
    const restore = makeRestore(locale);
    // Per-locale keep-English protection (e.g. 'friendly fraud' stays English in sv).
    const pl = (s: string) => protectForLocale(locale, s);
    try {
      const plain = [pl(enTitle), pl(enExcerpt), pl(enMetaTitle), pl(enMetaDesc), pl(enDisclaimer), ...kt.map(pl)];
      faq.forEach((f) => { plain.push(pl(f.q)); plain.push(pl(f.a)); });

      // Serialize the two DeepL calls (concurrent tripped the free-tier rate limit).
      const tPlain = await deeplTranslate(key, plain, targetLang, false);
      const tHtml = await deeplTranslate(key, [pl(enHtml)], targetLang, true);

      let i = 0;
      const title = capFirst(restore(tPlain[i++]));
      const excerpt = restore(tPlain[i++]);
      const meta_title = restore(tPlain[i++]);
      const meta_description = restore(tPlain[i++]);
      const disclaimer = restore(tPlain[i++]);
      const keyTakeaways = ktSrc.map(() => restore(tPlain[i++]));
      const newFaq = faqSrc.map(() => ({ q: restore(tPlain[i++]), a: restore(tPlain[i++]) }));
      const mainHtml = restore(tHtml[0] ?? "");

      const body_json = { ...b, mainHtml, keyTakeaways, faq: newFaq, disclaimer };
      const wc = wordCount(mainHtml);
      const reading = Math.max(1, Math.round(wc / 200));
      const nowIso = new Date().toISOString();
      const publishPatch = publish
        ? { is_published: true, quality_status: null, is_excluded_from_sitemap: false, migration_action: null }
        : {};

      const { data: existing } = await sb
        .from("content_localizations")
        .select("id, slug")
        .eq("content_item_id", contentItemId)
        .eq("locale", locale)
        .maybeSingle();

      if (existing) {
        const { error } = await sb.from("content_localizations").update({
          title, excerpt, meta_title, meta_description, body_json,
          reading_time_minutes: reading, translation_status: "complete",
          last_updated_at: nowIso, updated_at: nowIso, ...publishPatch,
        }).eq("id", existing.id);
        result.outcomes.push(error ? { locale, status: "failed", error: error.message } : { locale, status: "updated", words: wc });
      } else {
        const { error } = await sb.from("content_localizations").insert({
          content_item_id: contentItemId, locale, route_kind: routeKind,
          title, slug: slugify(title), excerpt, body_json, meta_title, meta_description,
          reading_time_minutes: reading, translation_status: "complete",
          last_updated_at: nowIso, ...publishPatch,
        });
        result.outcomes.push(error ? { locale, status: "failed", error: error.message } : { locale, status: "inserted", words: wc });
      }
    } catch (e) {
      result.outcomes.push({ locale, status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return result;
}
