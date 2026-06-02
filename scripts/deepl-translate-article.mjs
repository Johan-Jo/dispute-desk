/**
 * Translate ONE content_item's English source into a target hub locale using the
 * DeepL API, and UPDATE that locale's localization in place (preserving its slug,
 * so the public URL + hreflang stay stable). Single-article companion to
 * deepl-translate-locale.mjs — useful for spot demos / one-offs.
 *
 * OPTIONAL, MANUAL tool — NOT part of automated generation (the autopilot uses
 * Claude Sonnet natively; see docs/technical.md § "Generation model & cost controls").
 *
 * Requires env: DEEPL_API_KEY (free keys end ":fx"), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 *   DEEPL_API_KEY=... node scripts/deepl-translate-article.mjs <itemId|enSlug> --locale=sv-SE --publish
 *
 * Flags: --locale=sv-SE (target, required), --publish, --dry-run.
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
const locale = getArg("--locale", "sv-SE");
const publish = flags.has("--publish");
const dryRun = flags.has("--dry-run");
if (!target) { console.error("Pass a content_item id or en-US slug as the first arg"); process.exit(1); }

const DEEPL_LANG = { "sv-SE": "SV", "de-DE": "DE", "fr-FR": "FR", "es-ES": "ES", "pt-BR": "PT-BR" };
const targetLang = DEEPL_LANG[locale];
if (!targetLang) { console.error(`Unsupported locale ${locale}`); process.exit(1); }

const host = DEEPL.trim().endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
const sb = createClient(SB_URL, SB_KEY);
const words = (h) => (h ? h.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length : 0);

async function deepl(texts, html) {
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

async function main() {
  let itemId = /^[0-9a-f-]{36}$/i.test(target) ? target : null;
  if (!itemId) {
    const { data } = await sb.from("content_localizations").select("content_item_id").eq("locale", "en-US").eq("slug", target).maybeSingle();
    if (!data) { console.error(`No en-US article with slug "${target}"`); process.exit(1); }
    itemId = data.content_item_id;
  }

  const { data: en } = await sb.from("content_localizations")
    .select("title, excerpt, meta_title, meta_description, body_json")
    .eq("content_item_id", itemId).eq("locale", "en-US").maybeSingle();
  if (!en) { console.error("No en-US source for this item"); process.exit(1); }

  const { data: tgt } = await sb.from("content_localizations")
    .select("id, slug").eq("content_item_id", itemId).eq("locale", locale).maybeSingle();
  if (!tgt) { console.error(`No ${locale} row to update`); process.exit(1); }

  const b = en.body_json || {};
  const kt = b.keyTakeaways || [];
  const faq = b.faq || [];
  const plain = [en.title || "", en.excerpt || "", en.meta_title || "", en.meta_description || "", b.disclaimer || "", ...kt];
  faq.forEach((f) => { plain.push(f.q || ""); plain.push(f.a || ""); });

  console.log(`Translating item ${itemId} → ${locale} (DeepL ${targetLang}, host ${host})`);
  const [tPlain, tHtml] = await Promise.all([deepl(plain, false), deepl([b.mainHtml || ""], true)]);

  let i = 0;
  const title = tPlain[i++], excerpt = tPlain[i++], meta_title = tPlain[i++], meta_description = tPlain[i++], disclaimer = tPlain[i++];
  const keyTakeaways = kt.map(() => tPlain[i++]);
  const newFaq = faq.map(() => ({ q: tPlain[i++], a: tPlain[i++] }));
  const mainHtml = tHtml[0] || "";
  const body_json = { ...b, mainHtml, keyTakeaways, faq: newFaq, disclaimer };
  const wc = words(mainHtml);
  const reading = Math.max(1, Math.round(wc / 200));

  console.log(`  translated: ${wc} words | title: ${title}`);
  console.log(`  intro: ${mainHtml.replace(/<[^>]+>/g, " ").trim().slice(0, 240)}…`);

  if (dryRun) { console.log("(dry-run — no DB write)"); return; }

  const patch = {
    title, excerpt, meta_title, meta_description, body_json,
    reading_time_minutes: reading, translation_status: "complete",
    last_updated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...(publish ? { is_published: true, quality_status: null, is_excluded_from_sitemap: false, migration_action: null } : {}),
  };
  const { error } = await sb.from("content_localizations").update(patch).eq("id", tgt.id);
  if (error) { console.error("DB update failed:", error.message); process.exit(1); }
  console.log(`  ✓ ${locale} updated in place (slug kept: ${tgt.slug})${publish ? " + published" : " (held, not published)"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
