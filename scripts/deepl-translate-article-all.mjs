/**
 * Translate ONE content_item's finalized English source into ALL hub locales via
 * DeepL, inserting a localization row when the target locale doesn't exist yet and
 * updating it when it does. Companion to deepl-translate-article.mjs (which only
 * UPDATES an existing row) — needed when most locales have no row at all.
 *
 * English-first model: Claude writes only English; every other language is a DeepL
 * translation of that English. OPTIONAL/MANUAL one-off tool.
 *
 * Requires env: DEEPL_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 *   DEEPL_API_KEY=... node scripts/deepl-translate-article-all.mjs <itemId|enSlug> [--locales=sv-SE,de-DE,...] [--publish] [--dry-run]
 *
 * Defaults: --locales = all 5 non-English hub locales. --publish sets is_published.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEEPL = process.env.DEEPL_API_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
if (!DEEPL) { console.error("Missing DEEPL_API_KEY"); process.exit(1); }

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const getArg = (n, d) => { const a = args.find((x) => x.startsWith(`${n}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const target = args.find((a) => !a.startsWith("--"));
const publish = flags.has("--publish");
const dryRun = flags.has("--dry-run");
if (!target) { console.error("Pass a content_item id or en-US slug as the first arg"); process.exit(1); }

const DEEPL_LANG = { "sv-SE": "SV", "de-DE": "DE", "fr-FR": "FR", "es-ES": "ES", "pt-BR": "PT-BR" };
const ALL_LOCALES = Object.keys(DEEPL_LANG);
const locales = getArg("--locales", ALL_LOCALES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
for (const l of locales) if (!DEEPL_LANG[l]) { console.error(`Unsupported locale ${l}`); process.exit(1); }

// Established per-locale term for "chargeback" (matches messages/*.json UI convention).
// sv keeps the English loanword; the rest translate. {singular, plural} so the
// sentinel restore uses the grammatically-correct plural per language.
const CHARGEBACK_TERM = {
  "sv-SE": { s: "chargeback", p: "chargebacks" },
  "de-DE": { s: "Rückbuchung", p: "Rückbuchungen" },
  "fr-FR": { s: "rétrofacturation", p: "rétrofacturations" },
  "es-ES": { s: "contracargo", p: "contracargos" },
  "pt-BR": { s: "estorno", p: "estornos" },
};

const host = DEEPL.trim().endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
const sb = createClient(SB_URL, SB_KEY);
const words = (h) => (h ? h.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length : 0);

async function deepl(texts, targetLang, html) {
  if (texts.length === 0) return [];
  const body = { text: texts, target_lang: targetLang, source_lang: "EN" };
  if (html) body.tag_handling = "html";
  const res = await fetch(`${host}/v2/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `DeepL-Auth-Key ${DEEPL.trim()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DeepL ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()).translations || []).map((t) => t.text);
}

/** Build an ASCII slug from a translated title (DeepL gives native words; we transliterate). */
function slugify(s) {
  return (s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
    .slice(0, 80) || "artikel";
}

async function main() {
  let itemId = /^[0-9a-f-]{36}$/i.test(target) ? target : null;
  if (!itemId) {
    const { data } = await sb.from("content_localizations").select("content_item_id").eq("locale", "en-US").eq("slug", target).maybeSingle();
    if (!data) { console.error(`No en-US article with slug "${target}"`); process.exit(1); }
    itemId = data.content_item_id;
  }

  const { data: en } = await sb.from("content_localizations")
    .select("title, excerpt, meta_title, meta_description, body_json, route_kind")
    .eq("content_item_id", itemId).eq("locale", "en-US").maybeSingle();
  if (!en) { console.error("No en-US source for this item"); process.exit(1); }

  const b = en.body_json || {};

  // SENTINEL SWAP for terminology control: replace the English domain term
  // "chargeback(s)" with an OPAQUE token DeepL leaves untouched, translate, then
  // swap the token for the established per-locale term. This guarantees the right
  // term and NEVER touches legitimate "refund" wording (DeepL otherwise renders
  // chargeback as "devoluciones"/"reembolso" etc., which mean refund — a different
  // concept the article discusses).
  // The token must contain NO translatable substring: an earlier "CHARGEBACKTOKEN"
  // still had "CHARGEBACK" inside it, which DeepL partially translated. Use a
  // meaningless letter token instead. Plural distinguished by a trailing Z.
  const sub = (s) => (s || "")
    .replace(/chargebacks/gi, "QZXTERMZZS")
    .replace(/chargeback/gi, "QZXTERMZZ");
  const enTitle = sub(en.title), enExcerpt = sub(en.excerpt), enMetaTitle = sub(en.meta_title),
    enMetaDesc = sub(en.meta_description), enDisclaimer = sub(b.disclaimer);
  const kt = (b.keyTakeaways || []).map(sub);
  const faq = (b.faq || []).map((f) => ({ q: sub(f.q), a: sub(f.a) }));
  const enHtml = sub(b.mainHtml);

  for (const locale of locales) {
    const targetLang = DEEPL_LANG[locale];
    const term = CHARGEBACK_TERM[locale].s;
    const termPlural = CHARGEBACK_TERM[locale].p;
    // Restore tokens → locale term (plural FIRST so its longer match wins).
    // Case-insensitive because DeepL may recase the sentinel.
    const restore = (s) => (s || "")
      .replace(/qzxtermzzs/gi, termPlural)
      .replace(/qzxtermzz/gi, term);

    const plain = [enTitle, enExcerpt, enMetaTitle, enMetaDesc, enDisclaimer, ...kt];
    faq.forEach((f) => { plain.push(f.q); plain.push(f.a); });

    console.log(`\n→ ${locale} (DeepL ${targetLang}, term="${term}")`);
    // Serialize the DeepL calls — concurrent (Promise.all) tripped the free-tier
    // rate limit (456). One request at a time, small gap, stays within limits.
    const tPlain = await deepl(plain, targetLang, false);
    await new Promise((r) => setTimeout(r, 400));
    const tHtml = await deepl([enHtml], targetLang, true);
    await new Promise((r) => setTimeout(r, 400));

    let i = 0;
    const title = restore(tPlain[i++]), excerpt = restore(tPlain[i++]), meta_title = restore(tPlain[i++]),
      meta_description = restore(tPlain[i++]), disclaimer = restore(tPlain[i++]);
    const keyTakeaways = (b.keyTakeaways || []).map(() => restore(tPlain[i++]));
    const newFaq = (b.faq || []).map(() => ({ q: restore(tPlain[i++]), a: restore(tPlain[i++]) }));
    const mainHtml = restore(tHtml[0] || "");

    const body_json = { ...b, mainHtml, keyTakeaways, faq: newFaq, disclaimer };
    const wc = words(mainHtml);
    const reading = Math.max(1, Math.round(wc / 200));

    const { data: existing } = await sb.from("content_localizations")
      .select("id, slug").eq("content_item_id", itemId).eq("locale", locale).maybeSingle();

    console.log(`  ${wc} words | title: ${title.slice(0, 70)}`);
    if (dryRun) { console.log("  (dry-run — no write)"); continue; }

    const publishPatch = publish ? { is_published: true, quality_status: null, is_excluded_from_sitemap: false, migration_action: null } : {};
    if (existing) {
      const { error } = await sb.from("content_localizations").update({
        title, excerpt, meta_title, meta_description, body_json,
        reading_time_minutes: reading, translation_status: "complete",
        last_updated_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...publishPatch,
      }).eq("id", existing.id);
      if (error) { console.error(`  DB update failed (${locale}):`, error.message); continue; }
      console.log(`  ✓ updated in place (slug kept: ${existing.slug})${publish ? " + published" : ""}`);
    } else {
      const slug = slugify(title);
      const { error } = await sb.from("content_localizations").insert({
        content_item_id: itemId, locale, route_kind: en.route_kind,
        title, slug, excerpt, body_json, meta_title, meta_description,
        reading_time_minutes: reading, translation_status: "complete",
        last_updated_at: new Date().toISOString(), ...publishPatch,
      });
      if (error) { console.error(`  DB insert failed (${locale}):`, error.message); continue; }
      console.log(`  ✓ inserted (slug: ${slug})${publish ? " + published" : ""}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
