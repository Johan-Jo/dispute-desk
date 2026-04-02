/**
 * Optional smoke check for Resources Hub admin APIs.
 *
 * Requires a running app (e.g. `npx next dev -p 3099`) and in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   ADMIN_SMOKE_EMAIL, ADMIN_SMOKE_PASSWORD — portal user with internal_admin_grants
 *   Optional: SMOKE_BASE_URL (default http://localhost:3099)
 *
 * Usage:
 *   node scripts/smoke-resources-hub.mjs
 *
 * With seeded content (recommended):
 *   npm run seed:resources
 */

import { readFileSync } from "fs";
import { join } from "path";
import { createServerClient } from "@supabase/ssr";

function loadEnvLocal() {
  const envPath = join(process.cwd(), ".env.local");
  const out = {};
  try {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const k = trimmed.slice(0, idx);
      let v = trimmed.slice(idx + 1);
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    }
  } catch {
    // ignore missing .env.local
  }
  return out;
}

const env = { ...loadEnvLocal(), ...process.env };
const baseUrl = (env.SMOKE_BASE_URL || "http://localhost:3099").replace(/\/$/, "");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = env.ADMIN_SMOKE_EMAIL;
const password = env.ADMIN_SMOKE_PASSWORD;

const ok = "\x1b[32m✓\x1b[0m";
const fail = "\x1b[31m✗\x1b[0m";

function cookieHeaderFromJar(jar) {
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
}

async function run() {
  console.log("\n=== Resources Hub API smoke ===\n");

  if (!url || !anon) {
    console.log(`  ${fail} NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing`);
    process.exit(1);
  }
  if (!email || !password) {
    console.log(`  ${fail} ADMIN_SMOKE_EMAIL / ADMIN_SMOKE_PASSWORD missing (portal user with admin grant)`);
    process.exit(1);
  }

  const jar = new Map();
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          jar.set(name, value);
        }
      },
    },
  });

  const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signErr) {
    console.log(`  ${fail} Supabase sign-in: ${signErr.message}`);
    process.exit(1);
  }
  console.log(`  ${ok} Supabase session (admin grant required for /api/admin/*)`);

  const headers = {
    Cookie: cookieHeaderFromJar(jar),
  };

  const listRes = await fetch(`${baseUrl}/api/admin/resources/content?pageSize=5`, {
    headers,
  });

  if (!listRes.ok) {
    const t = await listRes.text();
    console.log(`  ${fail} GET /api/admin/resources/content → ${listRes.status} ${t.slice(0, 200)}`);
    process.exit(1);
  }

  const listJson = await listRes.json();
  const items = listJson.items ?? [];
  console.log(`  ${ok} Content list (total=${listJson.total ?? "?"}, page items=${items.length})`);

  if (items.length === 0) {
    console.log(`  ${fail} No content rows — run: npm run seed:resources`);
    process.exit(1);
  }

  const firstId = items[0].id;
  const getRes = await fetch(`${baseUrl}/api/admin/resources/content/${firstId}`, {
    headers,
  });

  if (!getRes.ok) {
    const t = await getRes.text();
    console.log(`  ${fail} GET /api/admin/resources/content/[id] → ${getRes.status} ${t.slice(0, 300)}`);
    process.exit(1);
  }

  const editorJson = await getRes.json();
  if (!editorJson.item?.id) {
    console.log(`  ${fail} Editor payload missing item.id`);
    process.exit(1);
  }

  console.log(`  ${ok} Editor GET for id=${firstId}`);

  const settingsRes = await fetch(`${baseUrl}/api/admin/resources/settings`, { headers });
  if (!settingsRes.ok) {
    console.log(`  ${fail} GET /api/admin/resources/settings → ${settingsRes.status}`);
    process.exit(1);
  }
  console.log(`  ${ok} CMS settings`);

  console.log(`\n=== Resources Hub API smoke passed (${baseUrl}) ===\n`);
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
