import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const PACK_ID = "0e01ba6d-9cf1-4302-837c-3cfc646326f2";

const { data: pack } = await sb
  .from("evidence_packs")
  .select("pack_json")
  .eq("id", PACK_ID)
  .single();

const sections = pack.pack_json?.sections ?? [];
const comm = sections.find((s) => (s.fieldsProvided ?? []).includes("customer_communication"));

console.log("── Customer Communication section (raw) ──");
if (!comm) { console.log("(no section)"); process.exit(0); }
console.log(`label:           ${comm.label}`);
console.log(`source:          ${comm.source}`);
console.log(`fieldsProvided:  ${JSON.stringify(comm.fieldsProvided)}`);
console.log("data:");
console.log(JSON.stringify(comm.data, null, 2));

console.log("\n── evidence_items rows for this pack with type=comms ──");
const { data: items } = await sb
  .from("evidence_items")
  .select("label, source, payload, created_at")
  .eq("pack_id", PACK_ID)
  .eq("type", "comms")
  .order("created_at", { ascending: false });
console.log(JSON.stringify(items, null, 2));
