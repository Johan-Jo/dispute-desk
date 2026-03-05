/**
 * Seed DisputeDesk Shopify test store with orders, fulfillments, and tracking events.
 * Uses REST POST /orders.json (bypasses DraftOrder protected-customer-data restriction).
 * Fulfillments + events still use GraphQL.
 *
 * Usage: node scripts/shopify/seed-teststore.mjs [--shop <domain>]
 * Example: node scripts/shopify/seed-teststore.mjs --shop surasvenne.myshopify.com
 * Requires .env.local (see scripts/shopify/README.md). --shop overrides SHOPIFY_STORE_DOMAIN.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { getAdminToken } from "./admin-token.mjs";

// --- Env ---------------------------------------------------------------------

function loadEnv() {
  const envPath = join(process.cwd(), ".env.local");
  try {
    const raw = readFileSync(envPath, "utf-8");
    const vars = {};
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
      else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      vars[key] = val;
    }
    return vars;
  } catch (e) {
    return {};
  }
}

const env = loadEnv();
const envKeys = Object.keys(env);
const has = (k) => env[k] != null && String(env[k]).trim() !== "";

// Optional --shop <domain> overrides SHOPIFY_STORE_DOMAIN
const args = process.argv.slice(2);
const shopIdx = args.indexOf("--shop");
const shopFromArg = shopIdx !== -1 ? args[shopIdx + 1] : null;

if (envKeys.length === 0) {
  console.error("No variables loaded from .env.local (missing file or empty?).");
} else if (
  !has("SHOPIFY_ADMIN_TOKEN") &&
  !has("SHOPIFY_ACCESS_TOKEN") &&
  !(
    (has("SHOPIFY_SEED_CLIENT_ID") && has("SHOPIFY_SEED_CLIENT_SECRET")) ||
    (has("SHOPIFY_ADMIN_CLIENT_ID") && has("SHOPIFY_ADMIN_CLIENT_SECRET")) ||
    (has("SHOPIFY_CLIENT_ID") && has("SHOPIFY_API_SECRET"))
  )
) {
  const status = ["SHOPIFY_ADMIN_TOKEN", "SHOPIFY_SEED_CLIENT_ID", "SHOPIFY_SEED_CLIENT_SECRET"]
    .map((k) => k + "=" + (has(k) ? "set" : "missing"))
    .join(", ");
  console.error("Auth keys in .env.local: " + status + ". Add SHOPIFY_ADMIN_TOKEN or SHOPIFY_SEED_CLIENT_ID + SHOPIFY_SEED_CLIENT_SECRET (store custom app). See scripts/shopify/README.md.");
}
const SHOPIFY_STORE_DOMAIN =
  shopFromArg?.trim() || env.SHOPIFY_STORE_DOMAIN || "disputedesk.myshopify.com";
const SHOPIFY_API_VERSION = env.SHOPIFY_API_VERSION || "2026-01";
const SEED_COUNT = Math.max(1, parseInt(env.SEED_COUNT || "20", 10) || 20);
const SEED_CURRENCY = (env.SEED_CURRENCY || "USD").toUpperCase();
const SEED_PRODUCT_COUNT = Math.max(2, parseInt(env.SEED_PRODUCT_COUNT || "10", 10) || 10);

const SCENARIOS = ["DELIVERED", "IN_TRANSIT", "NO_TRACKING", "PARTIAL"];

const SHOP_DOMAIN = SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
const GRAPHQL_URL = `https://${SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
const REST_BASE = `https://${SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}`;

// --- Helpers -----------------------------------------------------------------

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const BRAZIL_CITIES = [
  { city: "São Paulo", province: "SP", zip: "01310-100" },
  { city: "Rio de Janeiro", province: "RJ", zip: "20040-020" },
  { city: "Belo Horizonte", province: "MG", zip: "30130-100" },
  { city: "Curitiba", province: "PR", zip: "80010-000" },
  { city: "Porto Alegre", province: "RS", zip: "90010-270" },
];

function brazilAddress(prefix = "Rua") {
  const c = randItem(BRAZIL_CITIES);
  return {
    address1: `${prefix} ${randItem(["Floriano", "Augusta", "Oscar Freire", "Consolação"])}, ${randInt(100, 999)}`,
    city: c.city,
    province: c.province,
    country: "BR",
    zip: c.zip,
  };
}

async function gql(token, query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GraphQL request failed ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.errors && json.errors.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

async function restPost(token, path, body, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(`${REST_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = json?.errors
        ? typeof json.errors === "string"
          ? json.errors
          : JSON.stringify(json.errors)
        : `HTTP ${res.status}`;
      const isRateLimit = res.status === 429 || msg.toLowerCase().includes("rate limit");
      if (isRateLimit && attempt < retries) {
        const wait = 60_000 * attempt;
        console.log(`  Rate limited, waiting ${wait / 1000}s before retry ${attempt + 1}/${retries}...`);
        await sleep(wait);
        continue;
      }
      throw new Error(msg);
    }
    return json;
  }
}

// --- GraphQL operations (fulfillments + events only) -------------------------

const SHOP_QUERY = `
  query { shop { name } }
`;

const LOCATIONS_QUERY = `
  query {
    shop {
      locations(first: 1) {
        nodes { id }
      }
    }
  }
`;

const PRODUCT_CREATE = `
  mutation productCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        variants(first: 1) {
          nodes {
            id
            legacyResourceId
            inventoryItem { id }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

const PRODUCT_VARIANT_BULK_UPDATE = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;

const INVENTORY_SET_QUANTITIES = `
  mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors { code field message }
    }
  }
`;

const ORDER_BY_LEGACY_ID = `
  query orderByLegacyId($id: ID!) {
    order(id: $id) {
      id
      name
      legacyResourceId
      tags
      fulfillmentOrders(first: 10) {
        nodes {
          id
          status
          lineItems(first: 50) {
            nodes { id }
          }
        }
      }
    }
  }
`;

const FULFILLMENT_CREATE = `
  mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id }
      userErrors { field message }
    }
  }
`;

const FULFILLMENT_EVENT_CREATE = `
  mutation fulfillmentEventCreate($fulfillmentEvent: FulfillmentEventInput!) {
    fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
      fulfillmentEvent { id status }
      userErrors { field message }
    }
  }
`;

// --- Product seed (in-stock catalog for orders) -------------------------------

/** @returns {Promise<string|null>} Location GID or null */
async function getLocationId(token) {
  try {
    const data = await gql(token, LOCATIONS_QUERY);
    const nodes = data?.shop?.locations?.nodes;
    if (!nodes?.length) return null;
    return nodes[0].id;
  } catch (err) {
    console.warn("Could not fetch locations (missing read_locations?):", err.message);
    return null;
  }
}

/**
 * Create products with one variant each, set price and inventory. Returns variant info for order line_items.
 * @param {string} token
 * @param {string} locationId - Location GID
 * @returns {Promise<Array<{ variantIdLegacy: string, inventoryItemId: string, title: string, price: string }>>}
 */
async function createSeedProducts(token, locationId) {
  const variants = [];
  for (let n = 1; n <= SEED_PRODUCT_COUNT; n++) {
    const title = `DD Seed Product ${n}`;
    const price = (randInt(999, 9999) / 100).toFixed(2);
    const createRes = await gql(token, PRODUCT_CREATE, {
      product: { title, status: "ACTIVE" },
    });
    const payload = createRes?.productCreate;
    if (payload?.userErrors?.length) {
      console.warn(`  Product "${title}" create errors:`, payload.userErrors.map((e) => e.message).join("; "));
      continue;
    }
    const product = payload?.product;
    const variantNode = product?.variants?.nodes?.[0];
    if (!variantNode?.id || !variantNode?.inventoryItem?.id) {
      console.warn(`  Product "${title}" missing variant or inventoryItem`);
      continue;
    }
    const productId = product.id;
    await gql(token, PRODUCT_VARIANT_BULK_UPDATE, {
      productId,
      variants: [{ id: variantNode.id, price }],
    });
    const invRes = await gql(token, INVENTORY_SET_QUANTITIES, {
      input: {
        ignoreCompareQuantity: true,
        name: "available",
        reason: "correction",
        quantities: [
          {
            inventoryItemId: variantNode.inventoryItem.id,
            locationId,
            quantity: 100,
            compareQuantity: null,
          },
        ],
      },
    });
    if (invRes?.inventorySetQuantities?.userErrors?.length) {
      console.warn(`  Product "${title}" inventory errors:`, invRes.inventorySetQuantities.userErrors.map((e) => e.message).join("; "));
    }
    variants.push({
      variantIdLegacy: String(variantNode.legacyResourceId),
      inventoryItemId: variantNode.inventoryItem.id,
      title,
      price,
    });
    console.log(`  Created product: ${title} | price ${price} ${SEED_CURRENCY} | in stock 100`);
    await sleep(500);
  }
  return variants;
}

// --- Seeding -----------------------------------------------------------------

/**
 * @param {number} i - Order index
 * @param {string} scenario
 * @param {Array<{ variantIdLegacy: string, title: string, price: string }>} [seedVariants] - If set, orders use these variant IDs
 */
function buildRestOrder(i, scenario, seedVariants) {
  const ship = brazilAddress("Av");
  const bill = brazilAddress("Rua");
  const priceA = (randInt(2990, 19900) / 100).toFixed(2);
  const priceB = (randInt(1500, 8000) / 100).toFixed(2);
  const lineItems = seedVariants && seedVariants.length >= 2
    ? [
        {
          variant_id: Number(randItem(seedVariants).variantIdLegacy),
          quantity: randInt(1, 3),
        },
        {
          variant_id: Number(randItem(seedVariants).variantIdLegacy),
          quantity: 1,
        },
      ]
    : [
        {
          title: `Seed product A-${i}`,
          quantity: randInt(1, 3),
          price: priceA,
          requires_shipping: true,
          sku: `DD-SEED-${i}-A`,
          grams: 500,
        },
        {
          title: `Seed product B-${i}`,
          quantity: 1,
          price: priceB,
          requires_shipping: true,
          sku: `DD-SEED-${i}-B`,
          grams: 300,
        },
      ];
  return {
    order: {
      email: `seed+customer${i}@example.com`,
      note: `DisputeDesk seed order #${i} scenario ${scenario}`,
      tags: `DD_SEED,DD_SEED_BATCH:v1,DD_SCENARIO:${scenario}`,
      currency: SEED_CURRENCY,
      financial_status: "paid",
      send_receipt: false,
      send_fulfillment_receipt: false,
      shipping_address: {
        first_name: "Seed",
        last_name: `Customer ${i}`,
        address1: ship.address1,
        city: ship.city,
        province: ship.province,
        country: ship.country,
        zip: ship.zip,
        phone: `+5511999990${String(i).padStart(3, "0")}`,
      },
      billing_address: {
        first_name: "Seed",
        last_name: `Customer ${i}`,
        address1: bill.address1,
        city: bill.city,
        province: bill.province,
        country: bill.country,
        zip: bill.zip,
      },
      line_items: lineItems,
    },
  };
}

async function createOrder(token, i, seedVariants) {
  const scenario = SCENARIOS[i % SCENARIOS.length];
  const body = buildRestOrder(i, scenario, seedVariants);

  const json = await restPost(token, "/orders.json", body);
  const restOrder = json?.order;
  if (!restOrder?.id) throw new Error("REST orders.json did not return order id");

  await sleep(400);

  const gid = `gid://shopify/Order/${restOrder.id}`;
  const orderData = await gql(token, ORDER_BY_LEGACY_ID, { id: gid });
  const orderNode = orderData?.order;
  if (!orderNode) throw new Error("Could not query order via GraphQL after REST creation");

  return { orderNode, scenario };
}

async function createFulfillmentAndEvents(token, orderNode, scenario) {
  const fos = orderNode?.fulfillmentOrders?.nodes || [];
  const openFos = fos.filter((fo) => fo.status === "OPEN" || fo.status === "SCHEDULED");
  if (openFos.length === 0) {
    return { fulfilled: false, warning: "No open fulfillment orders" };
  }

  const trackingNumber = `DD${Date.now()}${randInt(100, 999)}`;
  const lineItemsByFulfillmentOrder = [];
  const firstFo = openFos[0];

  if (scenario === "PARTIAL" && firstFo.lineItems?.nodes?.length > 0) {
    const firstLineId = firstFo.lineItems.nodes[0].id;
    lineItemsByFulfillmentOrder.push({
      fulfillmentOrderId: firstFo.id,
      fulfillmentOrderLineItems: [{ id: firstLineId, quantity: 1 }],
    });
  } else {
    for (const fo of openFos) {
      lineItemsByFulfillmentOrder.push({ fulfillmentOrderId: fo.id });
    }
  }

  const fulfillmentInput = {
    lineItemsByFulfillmentOrder,
    trackingInfo: {
      company: "Correios",
      number: trackingNumber,
      url: `https://tracking.example.com/${trackingNumber}`,
    },
    notifyCustomer: false,
  };

  let fulfillmentId;
  try {
    const fcRes = await gql(token, FULFILLMENT_CREATE, { fulfillment: fulfillmentInput });
    const errs = fcRes?.fulfillmentCreate?.userErrors || [];
    if (errs.length) {
      return {
        fulfilled: false,
        warning: `fulfillmentCreate: ${errs.map((e) => e.message).join("; ")}. Missing fulfillment scopes? Add write_assigned_fulfillment_orders OR write_merchant_managed_fulfillment_orders + fulfill_and_ship_orders permission.`,
      };
    }
    fulfillmentId = fcRes?.fulfillmentCreate?.fulfillment?.id;
    if (!fulfillmentId) return { fulfilled: false, warning: "fulfillmentCreate returned no fulfillment id" };
  } catch (err) {
    return {
      fulfilled: false,
      warning: `fulfillmentCreate failed: ${err.message}. Add write_assigned_fulfillment_orders OR write_merchant_managed_fulfillment_orders and write_fulfillments, plus fulfill_and_ship_orders permission.`,
    };
  }

  const now = new Date();
  const events = [];
  if (scenario === "DELIVERED") {
    events.push(
      { status: "IN_TRANSIT", happenedAt: new Date(now.getTime() - 48 * 3600 * 1000).toISOString() },
      { status: "OUT_FOR_DELIVERY", happenedAt: new Date(now.getTime() - 2 * 3600 * 1000).toISOString() },
      { status: "DELIVERED", happenedAt: now.toISOString() }
    );
  } else if (scenario === "IN_TRANSIT") {
    events.push({ status: "IN_TRANSIT", happenedAt: new Date(now.getTime() - 24 * 3600 * 1000).toISOString() });
  }
  // NO_TRACKING and PARTIAL: fulfillment only, no events

  for (const ev of events) {
    await gql(token, FULFILLMENT_EVENT_CREATE, {
      fulfillmentEvent: {
        fulfillmentId,
        status: ev.status,
        happenedAt: ev.happenedAt,
        message: ev.status.replace(/_/g, " "),
      },
    });
    await sleep(100);
  }

  return { fulfilled: true, fulfillmentId, eventsCount: events.length };
}

function adminOrderUrl(legacyResourceId) {
  const handle = SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, "").split(".")[0] || "disputedesk";
  return `https://admin.shopify.com/store/${handle}/orders/${legacyResourceId}`;
}

// --- Main --------------------------------------------------------------------

async function main() {
  console.log("DisputeDesk Shopify seed — test store");
  console.log("Store:", SHOPIFY_STORE_DOMAIN, "| API:", SHOPIFY_API_VERSION, "| Products:", SEED_PRODUCT_COUNT, "| Orders:", SEED_COUNT, "| Currency:", SEED_CURRENCY);

  const token = await getAdminToken({ shop: SHOPIFY_STORE_DOMAIN, env });
  console.log("Admin API token obtained.\n");

  const shopRes = await gql(token, SHOP_QUERY);
  const shopName = shopRes?.shop?.name || SHOPIFY_STORE_DOMAIN;
  console.log(`Shop: ${shopName}\n`);

  let seedVariants = [];
  const locationId = await getLocationId(token);
  if (locationId) {
    console.log("Seeding products (in stock)...");
    seedVariants = await createSeedProducts(token, locationId);
    console.log(`Products created: ${seedVariants.length}. Orders will use catalog variants.\n`);
  } else {
    console.warn("No location found; skipping product seed. Orders will use ad-hoc line items.\n");
  }

  let fulfillmentWarningLogged = false;

  for (let i = 0; i < SEED_COUNT; i++) {
    try {
      const { orderNode, scenario } = await createOrder(token, i + 1, seedVariants);
      const legacyResourceId = orderNode.legacyResourceId;
      const name = orderNode.name || orderNode.id;
      const tags = orderNode.tags || [];

      const result = await createFulfillmentAndEvents(token, orderNode, scenario);
      if (!result.fulfilled && result.warning && !fulfillmentWarningLogged) {
        console.warn("\n[WARNING]", result.warning);
        fulfillmentWarningLogged = true;
      }

      const url = adminOrderUrl(legacyResourceId);
      console.log(`Order: ${name} | legacyResourceId: ${legacyResourceId}`);
      console.log(`  Admin: ${url}`);
      console.log(`  Scenario: ${scenario}${result.fulfilled ? ` | Fulfillment + ${result.eventsCount || 0} events` : ""}`);
      console.log(`  Tags: ${tags.join(", ")}\n`);
    } catch (err) {
      console.error(`Seed order ${i + 1} failed:`, err.message);
    }
    await sleep(15_000);
  }

  console.log(`Done. ${SEED_COUNT} orders requested.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
