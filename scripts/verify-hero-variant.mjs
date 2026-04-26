import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { calculateCaseStrength } from "../lib/argument/caseStrength.ts";

config({ path: ".env.local" });
const sb = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PACK_ID = "424bedfd-4d12-407f-a136-3f2b7fecb8ba";
const { data: pack } = await sb.from("evidence_packs").select("checklist_v2, pack_json").eq("id", PACK_ID).maybeSingle();
const { data: items } = await sb.from("evidence_items").select("payload, source").eq("pack_id", PACK_ID);

const collected = new Set();
for (const s of pack.pack_json?.sections ?? []) for (const f of s.fieldsProvided ?? []) collected.add(f);
for (const it of items ?? []) for (const f of (it.payload?.fieldsProvided ?? [])) collected.add(f);
const reconciled = (pack.checklist_v2 ?? []).map((c) => c.status === "missing" && collected.has(c.field) ? { ...c, status: "available" } : c);

const map = {};
for (const it of items ?? []) for (const f of (it.payload?.fieldsProvided ?? [])) if (!(f in map)) map[f] = it;
for (const s of pack.pack_json?.sections ?? []) for (const f of s.fieldsProvided ?? []) if (!(f in map)) map[f] = { payload: { ...(s.data ?? {}), fieldsProvided: s.fieldsProvided } };

const cs = calculateCaseStrength(null, reconciled, "FRAUDULENT", { kind: "byField", map });
console.log("OUTPUT:");
console.log("  overall:", cs.overall);
console.log("  heroVariant:", cs.heroVariant, "  ← drives hero label + tone");
console.log("  strongCount:", cs.strongCount);
console.log("  moderateCount:", cs.moderateCount);
console.log("  coveragePercent:", cs.coveragePercent + "%");
console.log("  strengthReason:", cs.strengthReason);
console.log("");
const labelMap = { likely_to_win: "Likely to win", could_win: "Could win", needs_strengthening: "Needs strengthening", hard_to_win: "Hard to win" };
const toneMap = { likely_to_win: "GREEN", could_win: "AMBER", needs_strengthening: "AMBER", hard_to_win: "RED" };
console.log("Hero will render:");
console.log("  Title:", labelMap[cs.heroVariant]);
console.log("  Tone:", toneMap[cs.heroVariant]);
