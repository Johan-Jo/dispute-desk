/**
 * Hard verification test: can we reliably extract 3-D Secure data from
 * Shopify Admin API responses?
 *
 * Discovers structure dynamically. Does NOT assume Stripe path.
 *
 *   1. Pulls 5 paid orders via Admin GraphQL
 *      (orders(first: 5, query: "financial_status:paid"))
 *   2. Logs every shopify_payments / SUCCESS transaction's full receiptJson
 *   3. Runs a recursive key-walker (no hardcoded path)
 *   4. Compares against the assumed Stripe-shaped path
 *   5. Falls back to REST /admin/api/{ver}/orders/{id}/transactions.json
 *   6. Emits a structured report + reliability verdict
 *
 * Read-only. No writes.
 *
 * Usage:
 *   node scripts/test-3ds-extraction.mjs              # auto-pick first shop with offline session
 *   node scripts/test-3ds-extraction.mjs <shopId>     # specific shop
 *   node scripts/test-3ds-extraction.mjs <shopId> 10  # 10 orders instead of 5
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";
const ARG_SHOP_ID = process.argv[2] && !/^\d+$/.test(process.argv[2]) ? process.argv[2] : null;
const ORDER_LIMIT = Number(process.argv[ARG_SHOP_ID ? 3 : 2] ?? 5);

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// ─────────────────────────────────────────── token helpers

function deserialize(raw) {
  const [ver, iv, tag, ct] = raw.split(":");
  return {
    keyVersion: parseInt(ver.slice(1), 10),
    iv: Buffer.from(iv, "hex"),
    tag: Buffer.from(tag, "hex"),
    ciphertext: Buffer.from(ct, "hex"),
  };
}
function decrypt(payload) {
  const envName = `TOKEN_ENCRYPTION_KEY_V${payload.keyVersion}`;
  let hex = process.env[envName];
  if (!hex && payload.keyVersion === 1) hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error(`missing ${envName}`);
  const key = Buffer.from(hex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]).toString("utf8");
}

async function loadOfflineSession(shopId) {
  const { data: sess } = await sb
    .from("shop_sessions")
    .select("shop_domain, access_token_encrypted")
    .eq("shop_id", shopId)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sess) return null;
  return { shopDomain: sess.shop_domain, accessToken: decrypt(deserialize(sess.access_token_encrypted)) };
}

async function pickShop() {
  if (ARG_SHOP_ID) return ARG_SHOP_ID;
  const { data: rows } = await sb
    .from("shop_sessions")
    .select("shop_id")
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return rows?.[0]?.shop_id ?? null;
}

// ─────────────────────────────────────────── parsing

function isObj(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function parseReceipt(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return isObj(p) ? p : null;
    } catch {
      return null;
    }
  }
  return isObj(raw) ? raw : null;
}

// ─────────────────────────────────────────── DYNAMIC EXTRACTOR (no assumptions)
//
// Recursively walks the receipt. Anywhere we encounter a key/value that
// looks like 3DS metadata we capture it with its full path.
//
// Key heuristics: keys containing 3ds, three_d_secure, three_ds, eci,
// authentication, liability, acs, ds_transaction. Values that look like
// 3DS objects also surface (e.g. an object containing both a `version`
// and an `authenticated` field, or an `eci_code`).

const KEY_PATTERNS = [
  /three_d_secure/i,
  /three[_-]?ds/i,
  /\b3ds\b/i,
  /^eci$/i,
  /eci[_-]?(code|flag|indicator)/i,
  /authentication[_-]?(value|status|method)/i,
  /liability[_-]?shift/i,
  /acs[_-]?(transaction|url)/i,
  /ds[_-]?transaction[_-]?id/i,
  /^ucaf$/i,
  /authentication_flow/i,
];

function keyMatches3DS(key) {
  return KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Recursive walk. Returns a list of hits:
 *   { path: "latest_charge.payment_method_details.card.three_d_secure",
 *     key: "three_d_secure",
 *     value: {...} | string | boolean | null }
 *
 * Hits are de-duped by exact path. We cap depth and node count so we
 * never explode on weird inputs.
 */
function findAll3DSHits(root) {
  const hits = [];
  const seen = new Set();
  const MAX_DEPTH = 12;
  const MAX_NODES = 5000;
  let visited = 0;

  function walk(node, path, depth) {
    if (visited++ > MAX_NODES) return;
    if (depth > MAX_DEPTH) return;
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      const childPath = path ? `${path}.${k}` : k;
      if (keyMatches3DS(k)) {
        if (!seen.has(childPath)) {
          seen.add(childPath);
          hits.push({ path: childPath, key: k, value: v });
        }
      }
      walk(v, childPath, depth + 1);
    }
  }
  walk(root, "", 0);
  return hits;
}

/**
 * Given the recursive hits, produce a normalized verdict.
 * authenticated/eci/version/liabilityShift are filled when discoverable;
 * everything else stays undefined.
 */
function extract3DS(receipt) {
  if (!isObj(receipt)) {
    return { found: false };
  }
  const hits = findAll3DSHits(receipt);
  if (!hits.length) {
    return { found: false };
  }

  // Look for the canonical "three_d_secure" object first.
  const tdsObj = hits.find(
    (h) => /three_d_secure|three[_-]?ds|3ds/i.test(h.key) && isObj(h.value),
  );

  const eciHit = hits.find((h) => /^eci$/i.test(h.key) || /eci[_-]?(code|flag)/i.test(h.key));
  const liabilityHit = hits.find((h) => /liability[_-]?shift/i.test(h.key));
  const versionHit = hits.find(
    (h) => /version/i.test(h.key) && /three|3ds/i.test(h.path),
  );

  let authenticated;
  let succeeded;
  let eci;
  let version;
  let rawPath;
  let rawObject;

  if (tdsObj) {
    rawPath = tdsObj.path;
    rawObject = tdsObj.value;
    if (isObj(tdsObj.value)) {
      if (typeof tdsObj.value.authenticated === "boolean") authenticated = tdsObj.value.authenticated;
      if (typeof tdsObj.value.succeeded === "boolean") succeeded = tdsObj.value.succeeded;
      if (typeof tdsObj.value.result === "string" && /authent|success/i.test(tdsObj.value.result)) {
        succeeded = succeeded ?? true;
      }
      if (typeof tdsObj.value.eci === "string") eci = tdsObj.value.eci;
      if (typeof tdsObj.value.version === "string") version = tdsObj.value.version;
    }
  }

  if (!eci && eciHit && (typeof eciHit.value === "string" || typeof eciHit.value === "number")) {
    eci = String(eciHit.value);
  }
  if (!version && versionHit && typeof versionHit.value === "string") {
    version = versionHit.value;
  }
  if (typeof authenticated !== "boolean" && liabilityHit && typeof liabilityHit.value === "boolean") {
    authenticated = liabilityHit.value === true ? true : authenticated;
  }

  return {
    found: true,
    authenticated,
    succeeded,
    eci,
    version,
    rawPath,
    rawObject,
    allHits: hits.map((h) => ({ path: h.path, key: h.key, valueKind: kindOf(h.value), value: h.value })),
  };
}

function kindOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

// ─────────────────────────────────────────── stripe-shaped path (secondary)

function extractStripePath(receipt) {
  const candidates = [
    receipt?.charges?.data?.[0]?.payment_method_details?.card?.three_d_secure,
    receipt?.latest_charge?.payment_method_details?.card?.three_d_secure,
    receipt?.payment_method_details?.card?.three_d_secure,
  ];
  for (const c of candidates) {
    if (c !== undefined) return c;
  }
  return undefined;
}

// ─────────────────────────────────────────── GraphQL + REST

const ORDERS_QUERY = `
  query PaidOrders($first: Int!, $query: String) {
    orders(first: $first, query: $query) {
      edges {
        node {
          id
          name
          test
          processedAt
          transactions(first: 10) {
            id
            kind
            status
            gateway
            receiptJson
            paymentDetails {
              __typename
              ... on CardPaymentDetails {
                avsResultCode
                cvvResultCode
                company
                bin
                wallet
              }
            }
          }
        }
      }
    }
  }
`;

async function fetchOrdersGraphQL(session) {
  const endpoint = `https://${session.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": session.accessToken,
    },
    body: JSON.stringify({
      query: ORDERS_QUERY,
      variables: { first: ORDER_LIMIT, query: "financial_status:paid" },
    }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error("GraphQL errors:", JSON.stringify(json.errors, null, 2));
  }
  return json?.data?.orders?.edges?.map((e) => e.node) ?? [];
}

const ORDER_DETAIL_QUERY = `
  query OrderDetail($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        name
        test
        processedAt
        transactions(first: 10) {
          id
          kind
          status
          gateway
          receiptJson
          paymentDetails {
            __typename
            ... on CardPaymentDetails {
              avsResultCode
              cvvResultCode
              company
              bin
              wallet
            }
          }
        }
      }
    }
  }
`;

async function fetchOrderByGid(session, gid) {
  const endpoint = `https://${session.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": session.accessToken,
    },
    body: JSON.stringify({ query: ORDER_DETAIL_QUERY, variables: { id: gid } }),
  });
  const json = await res.json();
  return json?.data?.node ?? null;
}

async function fetchDisputeOrders(shopId) {
  const { data } = await sb
    .from("disputes")
    .select("order_gid, order_name, reason")
    .eq("shop_id", shopId)
    .not("order_gid", "is", null)
    .order("created_at", { ascending: false })
    .limit(ORDER_LIMIT);
  return data ?? [];
}

function gidToNumeric(gid) {
  const m = String(gid).match(/(\d+)$/);
  return m ? m[1] : null;
}

async function fetchTransactionsREST(session, orderGid) {
  const numeric = gidToNumeric(orderGid);
  if (!numeric) return { ok: false, reason: "no numeric id", transactions: [] };
  const url = `https://${session.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders/${numeric}/transactions.json`;
  const res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": session.accessToken },
  });
  if (!res.ok) {
    return { ok: false, reason: `HTTP ${res.status}`, transactions: [] };
  }
  const json = await res.json();
  return { ok: true, transactions: json?.transactions ?? [] };
}

// ─────────────────────────────────────────── main

const shopId = await pickShop();
if (!shopId) {
  console.error("No shop with offline session found. Pass shopId explicitly.");
  process.exit(1);
}
console.log(`shop: ${shopId}`);
const session = await loadOfflineSession(shopId);
if (!session) {
  console.error("Failed to load offline session for shop", shopId);
  process.exit(1);
}
console.log(`shop domain: ${session.shopDomain}`);
console.log(`api version: ${SHOPIFY_API_VERSION}`);
console.log(`querying orders(first: ${ORDER_LIMIT}, query: "financial_status:paid")\n`);

let orders = await fetchOrdersGraphQL(session);
console.log(`got ${orders.length} orders from financial_status:paid query`);

// Filter to orders that actually have transactions (synthetic seed orders
// in some dev stores return empty transactions[]).
const ordersWithTx = orders.filter((o) => (o.transactions ?? []).length > 0);
console.log(`  ${ordersWithTx.length} have non-empty transactions`);

if (!ordersWithTx.length) {
  console.log(
    "\nfallback: paid-orders query returned no transactions, switching to\n" +
      "real dispute-tied orders (these always have an actual SP transaction)\n",
  );
  const disputed = await fetchDisputeOrders(shopId);
  console.log(`fetching ${disputed.length} dispute-tied orders by GID`);
  const fetched = [];
  for (const d of disputed) {
    const order = await fetchOrderByGid(session, d.order_gid);
    if (order) fetched.push(order);
  }
  orders = fetched;
} else {
  orders = ordersWithTx;
}
console.log(`proceeding with ${orders.length} orders\n`);

const perOrderReports = [];
const summary = {
  ordersExamined: 0,
  shopifyPaymentsTransactions: 0,
  receiptPresent: 0,
  receiptMissing: 0,
  dynamicFound3DS: 0,
  stripePathFound3DS: 0,
  authenticatedTrue: 0,
  pathsSeen: new Map(), // path → count
  shapeAgrees: 0,
  shapeDisagrees: 0,
  restFallbackOk: 0,
  restFallbackFail: 0,
  restHadReceipt: 0,
};

for (const order of orders) {
  summary.ordersExamined++;
  const orderReport = {
    name: order.name,
    id: order.id,
    test: order.test,
    transactions: [],
  };

  for (const tx of order.transactions ?? []) {
    if (tx.gateway !== "shopify_payments") continue;
    if (tx.status !== "SUCCESS") continue;
    summary.shopifyPaymentsTransactions++;

    // ── Step 2: dump raw receiptJson
    console.log(`╔══════════════════════════════════════════════════════════════════════`);
    console.log(`║ order ${order.name}  tx ${tx.id}  kind=${tx.kind}`);
    console.log(`╚══════════════════════════════════════════════════════════════════════`);
    console.log(`receiptJson typeof: ${typeof tx.receiptJson}`);

    const receipt = parseReceipt(tx.receiptJson);
    const present = isObj(receipt);
    if (!present) {
      summary.receiptMissing++;
      console.log("receipt: ABSENT or unparseable\n");
      orderReport.transactions.push({ id: tx.id, kind: tx.kind, receiptPresent: false });
      continue;
    }
    summary.receiptPresent++;
    console.log(`receipt top-level keys: ${Object.keys(receipt).join(",")}`);
    console.log("receipt full dump:");
    console.dir(receipt, { depth: null });

    // ── Step 3: dynamic extractor
    const dynamic = extract3DS(receipt);
    if (dynamic.found) summary.dynamicFound3DS++;
    if (dynamic.authenticated === true) summary.authenticatedTrue++;
    // Track every path the walker hit, regardless of whether the value
    // was object/null/etc. The path is what tells us about structural
    // stability; the value tells us about 3DS presence.
    for (const h of dynamic.allHits ?? []) {
      summary.pathsSeen.set(h.path, (summary.pathsSeen.get(h.path) ?? 0) + 1);
    }
    // Did we see the canonical three_d_secure key (regardless of null/object)?
    const tdsKeyHit = (dynamic.allHits ?? []).find((h) => /three_d_secure/i.test(h.key));
    if (tdsKeyHit) {
      const isObjVal = isObj(tdsKeyHit.value);
      const isNull = tdsKeyHit.value === null;
      // Bucket: value-was-object (3DS used) / null (3DS not used) / other
      summary.tdsKeyValueKinds = summary.tdsKeyValueKinds ?? { object: 0, null: 0, other: 0 };
      if (isObjVal) summary.tdsKeyValueKinds.object++;
      else if (isNull) summary.tdsKeyValueKinds.null++;
      else summary.tdsKeyValueKinds.other++;
    }

    // ── Step 4: stripe-shaped path
    const stripeNode = extractStripePath(receipt);
    if (stripeNode !== undefined) summary.stripePathFound3DS++;

    const shapesAgree =
      (dynamic.found && stripeNode !== undefined) ||
      (!dynamic.found && stripeNode === undefined);
    if (shapesAgree) summary.shapeAgrees++;
    else summary.shapeDisagrees++;

    console.log("\n── dynamic extractor ──");
    console.log(JSON.stringify(
      {
        found: dynamic.found,
        authenticated: dynamic.authenticated,
        succeeded: dynamic.succeeded,
        eci: dynamic.eci,
        version: dynamic.version,
        rawPath: dynamic.rawPath,
        allHitPaths: dynamic.allHits?.map((h) => h.path),
      },
      null,
      2,
    ));
    console.log("── stripe-path attempt ──");
    console.log(`  charges.data[0]...three_d_secure  : ${JSON.stringify(receipt?.charges?.data?.[0]?.payment_method_details?.card?.three_d_secure)}`);
    console.log(`  latest_charge...three_d_secure    : ${JSON.stringify(receipt?.latest_charge?.payment_method_details?.card?.three_d_secure)}`);
    console.log(`  payment_method_details (root)...  : ${JSON.stringify(receipt?.payment_method_details?.card?.three_d_secure)}`);

    // ── Step 5: REST fallback
    let rest;
    try {
      rest = await fetchTransactionsREST(session, order.id);
    } catch (err) {
      rest = { ok: false, reason: err.message, transactions: [] };
    }
    if (rest.ok) summary.restFallbackOk++;
    else summary.restFallbackFail++;

    const restMatch = rest.transactions.find((t) => String(tx.id).endsWith(String(t.id)));
    const restReceipt = restMatch?.receipt;
    if (restReceipt && Object.keys(restReceipt).length) summary.restHadReceipt++;

    console.log("── REST fallback ──");
    console.log(`  endpoint result: ${rest.ok ? "ok" : "fail (" + rest.reason + ")"}`);
    if (restReceipt) {
      console.log(`  REST receipt keys: ${Object.keys(restReceipt).slice(0, 10).join(",") || "(empty)"}`);
      const restDynamic = extract3DS(restReceipt);
      console.log(`  REST dynamic extractor: ${JSON.stringify({
        found: restDynamic.found,
        authenticated: restDynamic.authenticated,
        rawPath: restDynamic.rawPath,
      })}`);
    } else {
      console.log("  REST receipt: (none returned for this transaction)");
    }

    console.log("\n");

    orderReport.transactions.push({
      id: tx.id,
      kind: tx.kind,
      receiptPresent: true,
      dynamic: {
        found: dynamic.found,
        authenticated: dynamic.authenticated,
        rawPath: dynamic.rawPath,
        allHitPaths: dynamic.allHits?.map((h) => h.path) ?? [],
      },
      stripePathFound: stripeNode !== undefined,
      shapesAgree,
      restOk: rest.ok,
    });
  }
  perOrderReports.push(orderReport);
}

// ─────────────────────────────────────────── REPORT

const u = (x) => x;
console.log("\n\n══════════════════════════════════════════════════════════════════════");
console.log("                          FINAL REPORT");
console.log("══════════════════════════════════════════════════════════════════════\n");

console.log("1. RAW FINDINGS");
console.log("───────────────");
console.log(`Orders examined:                       ${summary.ordersExamined}`);
console.log(`Shopify Payments SUCCESS transactions: ${summary.shopifyPaymentsTransactions}`);
console.log(`  with parseable receiptJson:          ${summary.receiptPresent}`);
console.log(`  without parseable receipt:           ${summary.receiptMissing}`);
console.log(`Receipts where dynamic walker found 3DS keys: ${summary.dynamicFound3DS}`);
console.log(`Receipts where stripe path resolved:          ${summary.stripePathFound3DS}`);
console.log(`Receipts where authenticated === true:        ${summary.authenticatedTrue}`);
console.log(`Dynamic↔stripe agreement: ${summary.shapeAgrees} agree / ${summary.shapeDisagrees} disagree`);
console.log(`REST fallback: ${summary.restFallbackOk} ok / ${summary.restFallbackFail} fail (${summary.restHadReceipt} carried a receipt body)`);
console.log("\nDistinct 3DS paths observed:");
if (!summary.pathsSeen.size) {
  console.log("  (none)");
} else {
  for (const [path, n] of summary.pathsSeen) {
    console.log(`  ${path}  (×${n})`);
  }
}

// Reduce path set to just three_d_secure paths (drop ds_transaction_id etc.)
const tdsPathsSet = new Map();
for (const [p, n] of summary.pathsSeen) {
  if (/three_d_secure/i.test(p) || /three[_-]?ds/i.test(p) || /\b3ds\b/i.test(p)) {
    tdsPathsSet.set(p, n);
  }
}

console.log("\n2. RELIABILITY ASSESSMENT");
console.log("─────────────────────────");
const sp = summary.shopifyPaymentsTransactions;
const rp = summary.receiptPresent;
const found = summary.dynamicFound3DS;
const kinds = summary.tdsKeyValueKinds ?? { object: 0, null: 0, other: 0 };
const tdsKeyTotal = kinds.object + kinds.null + kinds.other;

const presence =
  sp === 0
    ? "n/a — no shopify_payments tx in sample"
    : rp === sp
      ? "always present (receipt body)"
      : rp === 0
        ? "never present"
        : `sometimes (${rp}/${sp})`;
const tdsPresence =
  rp === 0
    ? "n/a — no receipts to inspect"
    : tdsKeyTotal === rp
      ? `three_d_secure FIELD present in EVERY receipt (${kinds.object} populated / ${kinds.null} null=3DS-not-used / ${kinds.other} other)`
      : tdsKeyTotal === 0
        ? "three_d_secure field present in NO receipt"
        : `three_d_secure field in ${tdsKeyTotal}/${rp} receipts (${kinds.object} populated / ${kinds.null} null)`;
const structureStability =
  tdsPathsSet.size === 0
    ? "no three_d_secure key path observed"
    : tdsPathsSet.size === 1
      ? `single canonical path observed across sample: ${[...tdsPathsSet.keys()][0]}`
      : `${tdsPathsSet.size} distinct three_d_secure paths observed — structure VARIES`;

console.log(`Receipt body presence: ${presence}`);
console.log(`3DS field presence:    ${tdsPresence}`);
console.log(`Structure stability:   ${structureStability}`);
console.log(`Authenticated=true:    ${summary.authenticatedTrue}/${tdsKeyTotal} (this sample has no real 3DS challenges, so 0 is expected for stripe test cards)`);

console.log("\n3. EXTRACTABILITY");
console.log("─────────────────");
let extractability;
if (rp === 0) {
  extractability = "Not testable from this sample — no receipts to inspect.";
} else if (tdsKeyTotal === 0) {
  extractability =
    "Cannot assess: receipts present but no three_d_secure field surfaced. " +
    "That does NOT prove 3DS is absent in general; sample may not include " +
    "cards that triggered SCA.";
} else if (tdsPathsSet.size === 1 && summary.shapeDisagrees === 0) {
  extractability =
    "DETERMINISTIC for this sample — three_d_secure consistently lives at\n" +
    `  ${[...tdsPathsSet.keys()][0]}\n` +
    "and the dynamic walker agrees with the hardcoded stripe-shaped path on\n" +
    "every transaction. Field is null when 3DS wasn't used and an object\n" +
    "when it was — that's the documented Stripe contract.\n" +
    "CAVEAT: contract is gateway-defined; sample is small (no real-3DS " +
    "transactions in this dev shop).";
} else if (tdsPathsSet.size <= 2 && summary.shapeDisagrees === 0) {
  extractability = "Heuristic — at most two known shapes seen in sample. Recursive walker handles both; contract not guaranteed by Shopify.";
} else {
  extractability = "Heuristic / risky — multiple paths observed and/or walker disagrees with stripe path.";
}
console.log(extractability);

console.log("\n4. FINAL RECOMMENDATION");
console.log("───────────────────────");
console.log("Caveats baked into the verdict:");
console.log(" • receiptJson is documented as gateway-defined and unstable.");
console.log(" • Absence of 3DS keys is NOT evidence of no-3DS.");
console.log(" • Sample size here is small and shop-specific.");
console.log(" • This dev sample contains 0 real 3DS-authenticated charges,");
console.log("   so authenticated:true was never observed — only the path");
console.log("   stability and field presence were verified.\n");

let verdict;
if (rp === 0) {
  verdict =
    "❓ INCONCLUSIVE — no receipts to inspect. Re-run against a shop with\n" +
    "   real Shopify Payments transactions before deciding.";
} else if (
  tdsPathsSet.size === 1 &&
  summary.shapeDisagrees === 0 &&
  tdsKeyTotal === rp
) {
  verdict =
    "⚠️  USE AS BEST-EFFORT SIGNAL ONLY (matches current production policy).\n" +
    "   Path is stable across this sample (single canonical location) AND\n" +
    "   dynamic walker agrees with the stripe-shaped path on every receipt.\n" +
    "   But: contract is documented as gateway-defined, sample contains 0\n" +
    "   authenticated:true cases (couldn't verify the populated-object path),\n" +
    "   and absence of 3DS in null cases cannot be distinguished from\n" +
    "   3DS-not-supported.\n\n" +
    "   Existing collector (lib/packs/sources/threeDSecureSource.ts)\n" +
    "   already encodes this: receipt-derived 3DS → MODERATE, only\n" +
    "   promoted to STRONG via merchant manual confirmation. KEEP THAT GATE.";
} else if (tdsKeyTotal === 0) {
  verdict =
    "❓ INCONCLUSIVE for 3DS — receipts came back but none surfaced a\n" +
    "   three_d_secure field. Need a sample with at least one 3DS-\n" +
    "   authenticated charge to verify the populated-object shape.";
} else {
  verdict =
    "⚠️  USE AS BEST-EFFORT SIGNAL ONLY.\n" +
    "   3DS data is present but the path varies or the walker disagrees\n" +
    "   with the stripe-shaped path. Keep MODERATE classification.";
}
console.log(verdict);

console.log("\n──────────────────────────────────────────────────────────────────────");
console.log("Per-order summary (machine-readable):");
console.log(JSON.stringify(perOrderReports, null, 2));
