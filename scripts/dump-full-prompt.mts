/**
 * Print the EXACT system + user message that would be sent to OpenAI for
 * a given archive item, using the production prompt-builder code.
 *
 * Run with: npx tsx scripts/dump-full-prompt.mts <slug>
 */
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../.env.local") });

import { createClient } from "@supabase/supabase-js";
import { buildUserPrompt, resolveGenerationPrompts } from "@/lib/resources/generation/prompts";
import type { GenerationBrief } from "@/lib/resources/generation/prompts";

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const slug = process.argv[2] || "shopify-chargebacks-complete-merchant-guide";

const { data: row, error } = await sb
  .from("content_archive_items")
  .select("*")
  .eq("proposed_slug", slug)
  .maybeSingle();

if (error || !row) {
  console.error(`Not found: ${slug}`);
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

const resolved = resolveGenerationPrompts({});
const userMsg = buildUserPrompt(brief, "en-US", resolved, { similarArticles: [] });

console.log("═════════════════════════════════════════════════════════════════");
console.log("SYSTEM MESSAGE");
console.log("═════════════════════════════════════════════════════════════════\n");
console.log(resolved.systemPrompt);
console.log("\n═════════════════════════════════════════════════════════════════");
console.log("USER MESSAGE");
console.log("═════════════════════════════════════════════════════════════════\n");
console.log(userMsg);
