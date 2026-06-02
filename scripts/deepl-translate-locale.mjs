/**
 * Batch-translate every BELOW-FLOOR localization for one or more hub locales from
 * the English source, updating each in place (slug preserved). Cheap, deterministic
 * alternative to LLM per-locale generation.
 *
 * NOTE: This is an OPTIONAL, MANUALLY-RUN cost-saving tool. It is NOT part of the
 * automated generation pipeline (the daily autopilot generates NATIVELY per locale
 * on Claude Sonnet — see docs/technical.md § "Generation model & cost controls").
 * Machine translation trades native, market-specific copy for cheap throughput;
 * use it deliberately, knowing the SEO/quality tradeoff.
 *
 * Providers (--provider):
 *   deepl  (default) — DeepL API. Needs DEEPL_API_KEY (free keys end ":fx").
 *   google           — Google Cloud Translation v2. Needs GOOGLE_TRANSLATE_API_KEY
 *                      (or GOOGLE_API_KEY); the "Cloud Translation API" must be enabled.
 *
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and the provider key.
 *
 *   node scripts/deepl-translate-locale.mjs --locale=pt-BR,sv-SE --provider=google --publish
 *
 * Flags: --locale=xx-XX[,…] (required), --provider=deepl|google, --publish,
 *        --limit=N (per locale), --pace-ms=N (default 400), --dry-run.
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
if (!SB_URL || !SB_KEY) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const getArg = (n, d) => { const a = args.find((x) => x.startsWith(`${n}=`)); return a ? a.split("=").slice(1).join("=") : d; };
const locales = getArg("--locale", "").split(",").map((s) => s.trim()).filter(Boolean);
const provider = getArg("--provider", "deepl");
const publish = flags.has("--publish");
const dryRun = flags.has("--dry-run");
const limit = parseInt(getArg("--limit", "0"), 10) || 0;
const paceMs = parseInt(getArg("--pace-ms", "400"), 10);
if (locales.length === 0) { console.error("Pass --locale=de-DE[,fr-FR,…]"); process.exit(1); }

const DEEPL = (process.env.DEEPL_API_KEY || "").trim();
const GKEY = (process.env.GOOGLE_TRANSLATE_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
if (provider === "deepl" && !DEEPL) { console.error("Missing DEEPL_API_KEY"); process.exit(1); }
if (provider === "google" && !GKEY) { console.error("Missing GOOGLE_TRANSLATE_API_KEY (or GOOGLE_API_KEY)"); process.exit(1); }

const DEEPL_LANG = { "sv-SE": "SV", "de-DE": "DE", "fr-FR": "FR", "es-ES": "ES", "pt-BR": "PT-BR" };
const GOOGLE_LANG = { "sv-SE": "sv", "de-DE": "de", "fr-FR": "fr", "es-ES": "es", "pt-BR": "pt" };
const deeplHost = DEEPL.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
const sb = createClient(SB_URL, SB_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const words = (h) => (h ? h.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length : 0);
const floorFor = (t, hub) => (hub || t === "pillar_page") ? 3000 : (["cluster_article", "case_study", "legal_update"].includes(t) ? 1500 : 800);

let charsSent = 0; // tallied for the google provider (no usage endpoint)

async function deeplUsage() {
  const res = await fetch(`${deeplHost}/v2/usage`, { headers: { Authorization: `DeepL-Auth-Key ${DEEPL}` } });
  return res.ok ? res.json() : null;
}
async function deeplT(texts, locale, html) {
  const body = { text: texts, target_lang: DEEPL_LANG[locale], source_lang: "EN" };
  if (html) body.tag_handling = "html";
  const res = await fetch(`${deeplHost}/v2/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `DeepL-Auth-Key ${DEEPL}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DeepL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()).translations || []).map((t) => t.text);
}
async function googleT(texts, locale, html) {
  const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${GKEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: texts, target: GOOGLE_LANG[locale], source: "en", format: html ? "html" : "text" }),
  });
  if (!res.ok) throw new Error(`Google ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (((await res.json()).data || {}).translations || []).map((t) => t.translatedText);
}
async function translate(texts, locale, html) {
  if (texts.length === 0) return [];
  charsSent += texts.reduce((a, t) => a + (t || "").length, 0);
  return provider === "google" ? googleT(texts, locale, html) : deeplT(texts, locale, html);
}

async function translateItem(enRow, tgtRow, locale) {
  const b = enRow.body_json || {};
  const kt = b.keyTakeaways || [];
  const faq = b.faq || [];
  const plain = [enRow.title || "", enRow.excerpt || "", enRow.meta_title || "", enRow.meta_description || "", b.disclaimer || "", ...kt];
  faq.forEach((f) => { plain.push(f.q || ""); plain.push(f.a || ""); });
  const [tPlain, tHtml] = await Promise.all([translate(plain, locale, false), translate([b.mainHtml || ""], locale, true)]);
  let i = 0;
  const title = tPlain[i++], excerpt = tPlain[i++], meta_title = tPlain[i++], meta_description = tPlain[i++], disclaimer = tPlain[i++];
  const keyTakeaways = kt.map(() => tPlain[i++]);
  const newFaq = faq.map(() => ({ q: tPlain[i++], a: tPlain[i++] }));
  const body_json = { ...b, mainHtml: tHtml[0] || "", keyTakeaways, faq: newFaq, disclaimer };
  const wc = words(body_json.mainHtml);
  if (dryRun) return { wc, title };
  const patch = {
    title, excerpt, meta_title, meta_description, body_json,
    reading_time_minutes: Math.max(1, Math.round(wc / 200)), translation_status: "complete",
    last_updated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...(publish ? { is_published: true, quality_status: null, is_excluded_from_sitemap: false, migration_action: null } : {}),
  };
  const { error } = await sb.from("content_localizations").update(patch).eq("id", tgtRow.id);
  if (error) throw new Error(`DB: ${error.message}`);
  return { wc, title };
}

async function main() {
  console.log(`provider=${provider}  publish=${publish}  locales=${locales.join(",")}`);
  if (provider === "deepl") { const u = await deeplUsage(); if (u) console.log(`DeepL start: ${u.character_count.toLocaleString()}/${u.character_limit.toLocaleString()}`); }

  const { data: items } = await sb.from("content_items").select("id, content_type, is_hub_article");
  const itm = {}; (items || []).forEach((i) => itm[i.id] = { t: i.content_type, hub: i.is_hub_article });

  for (const locale of locales) {
    if (!(provider === "google" ? GOOGLE_LANG : DEEPL_LANG)[locale]) { console.log(`Skip unsupported locale ${locale}`); continue; }
    const { data: en } = await sb.from("content_localizations").select("content_item_id, title, excerpt, meta_title, meta_description, body_json").eq("locale", "en-US");
    const enById = {}; (en || []).forEach((r) => enById[r.content_item_id] = r);
    const { data: tg } = await sb.from("content_localizations").select("id, content_item_id, slug, body_json").eq("locale", locale);
    const below = (tg || []).filter((r) => {
      const meta = itm[r.content_item_id]; if (!meta) return false;
      return words(r.body_json && r.body_json.mainHtml) < floorFor(meta.t, meta.hub) && enById[r.content_item_id];
    });
    const todo = limit ? below.slice(0, limit) : below;
    console.log(`\n=== ${locale}: ${todo.length} below-floor articles ===`);
    let ok = 0, fail = 0;
    for (const [n, row] of todo.entries()) {
      try {
        const r = await translateItem(enById[row.content_item_id], row, locale);
        ok++; console.log(`  [${n + 1}/${todo.length}] ✓ ${row.slug} → ${r.wc}w`);
      } catch (e) {
        fail++; console.log(`  [${n + 1}/${todo.length}] ✗ ${row.slug} — ${e.message}`);
      }
      if (n < todo.length - 1) await sleep(paceMs);
    }
    console.log(`${locale}: ${ok} ok, ${fail} failed.`);
  }

  console.log(`\nSource characters sent this run: ${charsSent.toLocaleString()}`);
  if (provider === "deepl") { const u = await deeplUsage(); if (u) console.log(`DeepL end: ${u.character_count.toLocaleString()}/${u.character_limit.toLocaleString()} — ${(u.character_limit - u.character_count).toLocaleString()} free remaining.`); }
}

main().catch((e) => { console.error(e); process.exit(1); });
