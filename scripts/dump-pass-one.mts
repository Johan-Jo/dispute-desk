/**
 * Run Pass 1 only for a given archive item and dump the source material to stdout.
 * Lets us evaluate Pass 1 depth before paying for Pass 2 + retries.
 *
 * Usage:
 *   npx tsx scripts/dump-pass-one.mts <slug>
 *   defaults to shopify-chargebacks-complete-merchant-guide
 *
 * Reads from .env.local for OPENAI_API_KEY + SUPABASE_*.
 */
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { generatePassOne } from "@/lib/resources/generation/generate";
import type { GenerationBrief } from "@/lib/resources/generation/prompts";

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const slug = process.argv[2] || "shopify-chargebacks-complete-merchant-guide";
const locale = process.argv[3] || "en-US";

const { data: row, error } = await sb
  .from("content_archive_items")
  .select("*")
  .eq("proposed_slug", slug)
  .maybeSingle();

if (error || !row) {
  console.error(`Archive item ${slug} not found: ${error?.message ?? "no row"}`);
  process.exit(1);
}

const brief: GenerationBrief = {
  archiveItemId: row.id,
  proposedTitle: row.proposed_title,
  contentType: row.content_type,
  pageRole: row.page_role,
  primaryPillar: row.primary_pillar,
  targetKeyword: row.target_keyword,
  searchIntent: row.search_intent,
  complexity: row.complexity,
  targetWordRange: row.target_word_range,
  tier: row.tier_override,
  archetype: row.archetype,
  isHubArticle: row.is_hub_article,
  summary: row.summary,
  notes: row.notes,
  targetLocales: row.target_locale_set,
};

console.log(`Running Pass 1 for: ${slug} (${locale})\n`);

const result = await generatePassOne(brief, locale);

if (result.error) {
  console.error(`Pass 1 failed: ${result.error}`);
  console.error(`Tokens used: ${result.tokensUsed}`);
  process.exit(1);
}

console.log(`Pass 1 succeeded — tokens used: ${result.tokensUsed}\n`);
console.log("══════════════════════════════════════════════════════════════════");
console.log("PASS 1 OUTPUT:");
console.log("══════════════════════════════════════════════════════════════════\n");
console.log(JSON.stringify(result.material, null, 2));

// Quick depth metrics
const m = result.material!;
console.log("\n══════════════════════════════════════════════════════════════════");
console.log("DEPTH METRICS:");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`central_argument:                ${m.central_argument?.length ?? 0} chars`);
console.log(`primary_operational_sequence:    ${m.primary_operational_sequence?.length ?? 0} steps`);
console.log(`evidence_tensions:               ${m.evidence_tensions?.length ?? 0} tensions`);
console.log(`developed_scenarios:             ${m.developed_scenarios?.length ?? 0} scenarios`);
console.log(`inline_variance_constraints:     ${m.inline_variance_constraints?.length ?? 0} entries`);
console.log(`positioning_constraints:         ${m.positioning_constraints?.length ?? 0} entries`);

if (m.developed_scenarios?.length) {
  m.developed_scenarios.forEach((s, i) => {
    const totalChars =
      (s.scenario?.length ?? 0) +
      (s.timeline?.join(" ").length ?? 0) +
      (s.evidence_available?.join(" ").length ?? 0) +
      (s.why_the_case_is_vulnerable?.length ?? 0) +
      (s.better_response?.length ?? 0);
    console.log(`  scenario ${i + 1}: ${totalChars} chars total (timeline: ${s.timeline?.length ?? 0} events)`);
  });
}

if (m.evidence_tensions?.length) {
  m.evidence_tensions.forEach((t, i) => {
    const totalChars =
      (t.tension?.length ?? 0) +
      (t.strong_side?.length ?? 0) +
      (t.weak_side?.length ?? 0) +
      (t.how_to_frame_it?.length ?? 0);
    console.log(`  tension ${i + 1}: ${totalChars} chars total`);
  });
}
