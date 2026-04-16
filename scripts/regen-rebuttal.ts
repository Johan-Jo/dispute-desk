import { createClient } from "@supabase/supabase-js";
import { generateArgumentMap } from "../lib/argument/generateArgument";
import { generateRebuttalDraft } from "../lib/argument/generateRebuttal";
import { selectRebuttalReason } from "../lib/argument/rebuttalReason";
import type { ChecklistItemV2 } from "../lib/types/evidenceItem";
import { config } from "dotenv";
import { join } from "path";
config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const packId = "056f6bd2-a915-4c5c-80b6-42ff42af553b";
const disputeId = "4b4fb944-1f97-4e44-a08e-8e9b0b917bde";

async function main() {
  const { data: pack } = await sb
    .from("evidence_packs")
    .select("checklist_v2")
    .eq("id", packId)
    .single();

  const checklist = (pack?.checklist_v2 ?? []) as ChecklistItemV2[];

  const argMap = generateArgumentMap("FRAUDULENT", checklist);
  const reason = selectRebuttalReason("FRAUDULENT", checklist);
  const rebuttal = generateRebuttalDraft(argMap, reason);

  for (const s of rebuttal.sections) {
    console.log("[" + s.type + "]");
    console.log(s.text);
    console.log();
  }

  await sb.from("argument_maps").delete().eq("pack_id", packId);
  await sb.from("argument_maps").insert({
    dispute_id: disputeId,
    pack_id: packId,
    issuer_claim: argMap.issuerClaim,
    counterclaims: argMap.counterclaims,
    overall_strength: argMap.overallStrength,
  });

  await sb.from("rebuttal_drafts").upsert(
    {
      pack_id: packId,
      locale: "en-US",
      sections: rebuttal.sections,
      source: "GENERATED",
      version: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "pack_id,locale" },
  );

  console.log("Done — argument map + rebuttal inserted.");
}

main().catch(console.error);
