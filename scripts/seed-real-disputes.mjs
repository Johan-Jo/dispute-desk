#!/usr/bin/env node
/**
 * Real dispute generator (MVP): places Shopify Payments test-mode orders via
 * storefront checkout using the disputed-transaction test card, then tags
 * orders via Admin API. Creates real chargebacks in Shopify Payments Disputes.
 *
 * Usage: node scripts/seed-real-disputes.mjs --shop <domain> --product-handle <handle> [options]
 *        npm run seed:real-disputes -- --shop surasvenne.myshopify.com --product-handle my-product --i-know-this-is-test-mode
 *
 * Requires: SHOPIFY_PAYMENTS_TEST_MODE_ACK=true OR --i-know-this-is-test-mode
 *           For tagging: SHOPIFY_ADMIN_TOKEN (or --admin-token) OR same app credentials
 *           as seed:shopify (SHOPIFY_CLIENT_ID + SHOPIFY_API_SECRET) with app installed on --shop.
 */

import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createRequire } from "module";
import { getAdminToken } from "./shopify/admin-token.mjs";
const require = createRequire(import.meta.url);

const CARD_NUMBER = "4000000000000259";
const CARD_MASK = "4000…0259";
const TEST_CARD = { number: CARD_NUMBER, expiry: "1230", cvc: "123" };

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
  } catch {
    return {};
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name, def) => {
    const i = args.indexOf(name);
    if (i === -1) return def;
    if (args[i + 1] === undefined || args[i + 1].startsWith("--")) return def === undefined ? true : def;
    return args[i + 1];
  };
  const bool = (name) => args.includes(name);
  const env = loadEnv();
  const shop = get("--shop") || env.SHOPIFY_STORE_DOMAIN || (args[0] && !String(args[0]).startsWith("--") ? args[0] : undefined);
  const countArg = get("--count");
  const countPos = args[2] && !String(args[2]).startsWith("--") ? parseInt(args[2], 10) : NaN;
  const count = Math.max(1, (countArg != null ? parseInt(countArg, 10) : NaN) || (Number.isFinite(countPos) ? countPos : 1) || 1);
  const headless = get("--headless", "true") !== "false";
  const runId = get("--run-id") || `${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;
  const tag = get("--tag", "dd-real-dispute");
  const productHandle = get("--product-handle") || (args[1] && !String(args[1]).startsWith("--") ? args[1] : undefined);
  const variantId = get("--variant-id");
  const quantity = Math.max(1, parseInt(get("--quantity", "1"), 10) || 1);
  const storefrontPassword = get("--storefront-password") || env.STOREFRONT_PASSWORD;
  const iKnowThisIsTestMode = bool("--i-know-this-is-test-mode");
  const adminToken = get("--admin-token") || env.SHOPIFY_ADMIN_TOKEN || env.SHOPIFY_ACCESS_TOKEN;
  const apiVersion = get("--api-version") || env.SHOPIFY_API_VERSION || "2026-01";
  const timeoutMs = Math.max(10000, parseInt(get("--timeout-ms", "60000"), 10) || 60000);
  const shopNormalized = shop?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "";
  const storefrontDomain = get("--storefront-url") || env.SHOPIFY_STOREFRONT_DOMAIN;
  const storefrontBaseUrl = storefrontDomain
    ? String(storefrontDomain).replace(/\/$/, "")
    : `https://${shopNormalized}`;

  return {
    shop: shopNormalized,
    storefrontBaseUrl,
    runId,
    count,
    headless,
    tag,
    productHandle,
    variantId,
    quantity,
    storefrontPassword,
    iKnowThisIsTestMode,
    adminToken: adminToken?.trim(),
    apiVersion,
    timeoutMs,
  };
}

// --- Guardrails --------------------------------------------------------------

function assertPreconditions(opts) {
  const env = loadEnv();
  const ack =
    process.env.SHOPIFY_PAYMENTS_TEST_MODE_ACK === "true" ||
    env.SHOPIFY_PAYMENTS_TEST_MODE_ACK === "true" ||
    opts.iKnowThisIsTestMode;
  if (!ack) {
    console.error(
      "You must acknowledge Shopify Payments test mode. Set SHOPIFY_PAYMENTS_TEST_MODE_ACK=true in .env.local or pass --i-know-this-is-test-mode."
    );
    console.error("(When using npm run, flags may not be forwarded; use .env.local for the ack.)");
    process.exit(1);
  }
  if (!opts.shop) {
    console.error("--shop <domain> is required (e.g. surasvenne.myshopify.com).");
    process.exit(1);
  }
  if (!opts.productHandle && !opts.variantId) {
    console.error("One of --product-handle <handle> or --variant-id <id> is required.");
    process.exit(1);
  }
  if (opts.productHandle && opts.variantId) {
    console.error("Use only one of --product-handle or --variant-id.");
    process.exit(1);
  }
  const hasToken = opts.adminToken && opts.adminToken.length > 0;
  const hasAppCreds =
    (env.SHOPIFY_CLIENT_ID || env.SHOPIFY_API_KEY) && (env.SHOPIFY_API_SECRET);
  if (!hasToken && !hasAppCreds) {
    console.error(
      "Tagging requires one of: SHOPIFY_ADMIN_TOKEN (or --admin-token), or SHOPIFY_CLIENT_ID + SHOPIFY_API_SECRET in .env.local (same as seed:shopify; app must be installed on --shop)."
    );
    process.exit(1);
  }
}

// --- Admin API ---------------------------------------------------------------

function restGet(token, shop, apiVersion, path) {
  const url = `https://${shop}/admin/api/${apiVersion}${path}`;
  return fetch(url, {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
  }).then((r) => r.json());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function restPut(token, shop, apiVersion, path, body) {
  const url = `https://${shop}/admin/api/${apiVersion}${path}`;
  return fetch(url, {
    method: "PUT",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}

async function findOrderByEmailAndTag(token, shop, apiVersion, email, runId, tag, seq, opts) {
  const createdMin = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const path = `/orders.json?status=any&limit=50&created_at_min=${encodeURIComponent(createdMin)}`;
  const maxAttempts = 5;
  const backoffMs = [0, 2000, 5000, 10000, 15000];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, backoffMs[attempt]));
    const data = await restGet(token, shop, apiVersion, path);
    const orders = data?.orders || [];
    const order = orders.find((o) => (o.email || "").toLowerCase() === email.toLowerCase());
    if (order) {
      const existingTags = (order.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      const newTags = [...new Set([...existingTags, tag, `dd-run:${runId}`, `dd-seq:${seq}`])].join(", ");
      const putRes = await restPut(token, shop, apiVersion, `/orders/${order.id}.json`, {
        order: { id: order.id, tags: newTags },
      });
      if (putRes.order) {
        return {
          seq,
          email,
          orderId: String(order.id),
          orderName: order.name || order.order_number ? `#${order.order_number}` : null,
          confirmationUrl: null,
          status: "tagged",
        };
      }
      return {
        seq,
        email,
        orderId: String(order.id),
        orderName: order.name || `#${order.order_number}`,
        confirmationUrl: null,
        status: "found_but_tag_failed",
        error: putRes.errors ? JSON.stringify(putRes.errors) : "PUT failed",
      };
    }
  }
  return {
    seq,
    email,
    orderId: null,
    orderName: null,
    confirmationUrl: null,
    status: "not_found",
    error: "Order not found within 60s",
  };
}

// --- Artifacts ---------------------------------------------------------------

const ARTIFACTS_DIR = join(process.cwd(), "artifacts", "real-disputes");

function ensureArtifactDir(runId) {
  const dir = join(ARTIFACTS_DIR, runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRunArtifact(runId, payload) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const path = join(ARTIFACTS_DIR, `${runId}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf-8");
  return path;
}

async function saveFailureArtifacts(page, runId, seq) {
  const dir = ensureArtifactDir(runId);
  try {
    await page.screenshot({ path: join(dir, `fail-${seq}.png`) });
  } catch (_) {}
  try {
    const html = await page.content();
    writeFileSync(join(dir, `fail-${seq}.html`), html, "utf-8");
  } catch (_) {}
}

async function saveStepScreenshot(page, runId, stepName, seq) {
  try {
    const dir = ensureArtifactDir(runId);
    const safe = stepName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    await page.screenshot({ path: join(dir, `step-${seq}-${safe}.png`) });
  } catch (_) {}
}

// --- Checkout flow (Puppeteer) ------------------------------------------------

const SHIPPING = {
  first: "DisputeDesk",
  last: "Test",
  address1: "123 Main St",
  city: "New York",
  province: "NY",
  zip: "10001",
  country: "United States",
  phone: "5555550100",
};

async function fillInputByPlaceholderOrLabel(page, patterns, value, delay = 60, excludePattern) {
  const inputs = await page.$$('input:not([type="hidden"]):not([type="submit"])');
  const pat = Array.isArray(patterns) ? patterns : [patterns];
  const re = new RegExp(pat.join("|"), "i");
  const exclude = excludePattern ? new RegExp(excludePattern, "i") : null;
  for (const input of inputs) {
    const hint = await input.evaluate((el) =>
      [el.placeholder, el.getAttribute("aria-label"), el.name, el.id].filter(Boolean).join(" ")
    );
    if (!re.test(hint)) continue;
    if (exclude && exclude.test(hint)) continue;
    try {
      await input.click({ clickCount: 3 });
      await input.type(value, { delay });
      return true;
    } catch (_) {}
  }
  return false;
}

async function typeInFrame(frame, selector, text, delay = 80) {
  const el = await frame.$(selector);
  if (!el) return false;
  await el.click({ clickCount: 3 });
  await el.type(text, { delay });
  return true;
}

async function dismissSaveAddressModal(page) {
  try {
    const buttons = await page.$$("button, [role='button'], a");
    for (const btn of buttons) {
      const text = await page.evaluate((el) => el.textContent || "", btn).catch(() => "");
      if (/no,?\s*thanks|not now|skip|no thanks/i.test(text.trim())) {
        await btn.click();
        await sleep(500);
        return true;
      }
    }
  } catch (_) {}
  return false;
}

async function fillCardInCheckout(page, timeoutMs) {
  await sleep(2000);
  await dismissSaveAddressModal(page);
  await sleep(500);

  const filled = { number: false, expiry: false, cvc: false };

  // Scroll payment section into view and wait for it to render
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2, h3, legend, div, span")].find((el) =>
      /^payment$/i.test(el.textContent?.trim())
    );
    if (h) h.scrollIntoView({ behavior: "instant", block: "center" });
  });
  await sleep(2000);

  // Use label-based matching exclusively: find each card field by its label text,
  // mark it with a data attribute, then fill via Puppeteer handle.
  await page.evaluate(() => {
    const labels = document.querySelectorAll("label");
    for (const label of labels) {
      const text = (label.textContent || "").trim().toLowerCase();
      const forId = label.getAttribute("for");
      const input = (forId ? document.getElementById(forId) : null) || label.querySelector("input");
      if (!input || input.hidden || input.type === "hidden") continue;
      if (/card\s*number/.test(text)) input.setAttribute("data-dd-card", "number");
      else if (/expir|expiry|mm\s*\/?\s*yy/.test(text)) input.setAttribute("data-dd-card", "expiry");
      else if (/security\s*code|cvc|cvv/.test(text)) input.setAttribute("data-dd-card", "cvc");
    }
  });

  const fillField = async (selector, value, isExpiry) => {
    const el = await page.$(selector);
    if (!el) return false;
    try {
      await el.click();
      await sleep(200);
      // Select all and delete any existing content
      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");
      await sleep(50);
      await page.keyboard.press("Delete");
      await sleep(200);
      if (isExpiry) {
        // Type expiry as MM/YY using keyboard.type which dispatches proper events
        // The mask auto-formats, so just type the raw digits with pauses
        await page.keyboard.type(value.substring(0, 2), { delay: 200 });
        await sleep(500);
        await page.keyboard.type(value.substring(2, 4), { delay: 200 });
      } else {
        await el.type(value, { delay: 60 });
      }
      await sleep(300);
      return true;
    } catch (e) {
      console.log(`  [card-fill] Failed on ${selector}: ${e.message.substring(0, 60)}`);
      return false;
    }
  };

  filled.number = await fillField('[data-dd-card="number"]', CARD_NUMBER, false);
  console.log(`  [card-fill] Card number: ${filled.number ? "OK" : "NOT FOUND"}`);
  await sleep(500);

  filled.expiry = await fillField('[data-dd-card="expiry"]', TEST_CARD.expiry, true);
  console.log(`  [card-fill] Expiry: ${filled.expiry ? "OK" : "NOT FOUND"}`);
  await sleep(500);

  filled.cvc = await fillField('[data-dd-card="cvc"]', TEST_CARD.cvc, false);
  console.log(`  [card-fill] CVC: ${filled.cvc ? "OK" : "NOT FOUND"}`);

  // Read back expiry value to verify
  const expiryVal = await page.evaluate(() => {
    const el = document.querySelector('[data-dd-card="expiry"]');
    return el ? el.value : "(not found)";
  });
  console.log(`  [card-fill] Expiry readback: "${expiryVal}"`);

  console.log("  [card-fill] Final:", JSON.stringify(filled));
  return true;
}

async function submitStorefrontPasswordIfPresent(page, password, timeoutMs) {
  const passInput = await page.$('input[type="password"], input[name*="password"]');
  if (!passInput || !password) return false;
  const action = await page.$('form[action*="password"]');
  if (!action) return false;
  await passInput.click({ clickCount: 3 });
  await passInput.type(password, { delay: 50 });
  const submit = await page.$('button[type="submit"], input[type="submit"]');
  if (submit) await submit.click();
  await sleep(3000);
  await page.waitForNavigation({ waitUntil: "load", timeout: timeoutMs }).catch(() => {});
  return true;
}

async function runOneCheckout(opts, seq, runId, results, puppeteer) {
  const email = `dd+${runId}+${seq}@example.com`;
  const shop = opts.shop;
  const baseUrl = opts.storefrontBaseUrl || `https://${shop}`;
  const chromeArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu",
    "--disable-gpu-sandbox",
    "--disable-software-rasterizer",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-translate",
    "--no-first-run",
  ];
  const launchOpts = {
    headless: opts.headless,
    args: chromeArgs,
    defaultViewport: { width: 1280, height: 800 },
    timeout: 30000,
  };
  const env = loadEnv();
  const preferBundled = process.env.USE_SYSTEM_CHROME === "false" || env.USE_SYSTEM_CHROME === "false";
  if (!preferBundled) launchOpts.channel = "chrome";
  let browser;
  try {
    browser = await puppeteer.launch(launchOpts);
  } catch (e) {
    if (launchOpts.channel) {
      delete launchOpts.channel;
      browser = await puppeteer.launch(launchOpts);
    } else throw e;
  }
  const page = await browser.newPage();
  page.setDefaultTimeout(opts.timeoutMs);
  page.setDefaultNavigationTimeout(opts.timeoutMs);

  try {
    if (opts.variantId) {
      await page.goto(`${baseUrl}/cart/${opts.variantId}:${opts.quantity}`, {
        waitUntil: "load",
        timeout: opts.timeoutMs,
      });
    } else {
      const productUrl = `${baseUrl}/products/${opts.productHandle}`;
      const maxProductAttempts = 4;
      for (let attempt = 1; attempt <= maxProductAttempts; attempt++) {
        await page.goto(productUrl, { waitUntil: "load", timeout: opts.timeoutMs });
        await submitStorefrontPasswordIfPresent(page, opts.storefrontPassword, opts.timeoutMs);
        await sleep(1500);
        const url = page.url();
        if (url.includes("/products/")) break;
        if (attempt < maxProductAttempts) {
          if (!opts.headless) await saveStepScreenshot(page, opts.runId, `after-password-attempt-${attempt}`, seq);
          if (opts.headless === false) console.log(`  [${seq}] On landing page after password, re-navigating to product (attempt ${attempt + 1}/${maxProductAttempts})…`);
        } else {
          throw new Error(`Still on landing page after ${maxProductAttempts} attempts. URL: ${url}`);
        }
      }
      if (!opts.headless) await saveStepScreenshot(page, opts.runId, "product-page", seq);
      const addSel = ['input[name="add"]', 'button[name="add"]', '[name="add"]'];
      const addSelector = addSel.join(", ");
      await page.waitForSelector(addSelector, { timeout: 15000 }).catch(() => null);
      let added = false;
      for (const sel of addSel) {
        try {
          const el = await page.$(sel);
          if (el) {
            await el.click();
            added = true;
            break;
          }
        } catch (_) {}
      }
      if (!added) {
        const buttons = await page.$$('button, input[type="submit"]');
        for (const b of buttons) {
          const text = await page.evaluate((el) => el.value || el.textContent || "", b);
          if (/add to cart|add to bag/i.test(text)) {
            await b.click();
            added = true;
            break;
          }
        }
      }
      if (!added) {
        const anyAdd = await page.$('button, input[type="submit"], [name="add"]');
        if (anyAdd) await anyAdd.click();
      }
      await sleep(1500);
    }
    if (!opts.headless) await saveStepScreenshot(page, opts.runId, "after-add-to-cart", seq);

    await page.goto(`${baseUrl}/checkout`, { waitUntil: "load", timeout: opts.timeoutMs });

    await submitStorefrontPasswordIfPresent(page, opts.storefrontPassword, opts.timeoutMs);
    await sleep(1000);
    if (!opts.headless) await saveStepScreenshot(page, opts.runId, "checkout-page", seq);

    const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (/password incorrect|wrong password/i.test(bodyText)) {
      throw new Error("Storefront password rejected. Check STOREFRONT_PASSWORD in .env.local or --storefront-password.");
    }

    // Contact: email or mobile (match placeholder/label from checkout UI)
    const emailSel = 'input[name="checkout[email]"], input[name="contact[email]"], #checkout_email, input[type="email"]';
    await page.waitForSelector("input", { timeout: 15000 }).catch(() => null);
    let emailFilled = false;
    const emailEl = await page.$(emailSel);
    if (emailEl) {
      try {
        await emailEl.click({ clickCount: 3 });
        await emailEl.type(email, { delay: 80 });
        emailFilled = true;
      } catch (_) {}
    }
    if (!emailFilled) {
      emailFilled = await fillInputByPlaceholderOrLabel(
        page,
        ["email", "mobile phone", "phone number", "contact"],
        email,
        80
      );
    }

    // Continue to shipping (if there is a step button)
    const contBtn = await page.$('button[name="commit"], input[name="commit"]');
    if (contBtn) await contBtn.click();
    await sleep(2000);

    // Shipping address: by name/id first, then by placeholder/label.
    // fill() skips inputs inside the payment/shop-pay section to avoid "Mobile phone (optional)".
    const fill = async (name, value) => {
      const els = await page.$$(`input[name*="${name}"], input[id*="${name}"]`);
      for (const el of els) {
        const inPayment = await el.evaluate((el) => {
          const ctx = (el.closest("[class*=payment]") || el.closest("[class*=shop-pay]") || el.closest("[data-payment]")) != null;
          const label = (el.closest("label")?.textContent || el.placeholder || "").toLowerCase();
          return ctx || /mobile.*optional|save.*information|faster.*checkout/.test(label);
        });
        if (inPayment) continue;
        await el.click({ clickCount: 3 }).catch(() => {});
        await el.type(value, { delay: 50 });
        return true;
      }
      return false;
    };
    await fill("first", SHIPPING.first) ||
      (await fillInputByPlaceholderOrLabel(page, ["first name"], SHIPPING.first, 50));
    await fill("last", SHIPPING.last) ||
      (await fillInputByPlaceholderOrLabel(page, ["last name"], SHIPPING.last, 50));
    await fill("address1", SHIPPING.address1) ||
      (await fillInputByPlaceholderOrLabel(page, ["address", "street"], SHIPPING.address1, 50));
    await fill("city", SHIPPING.city) ||
      (await fillInputByPlaceholderOrLabel(page, ["city"], SHIPPING.city, 50));
    await fill("province", SHIPPING.province) ||
      (await fill("state", SHIPPING.province)) ||
      (await fillInputByPlaceholderOrLabel(page, ["state", "province"], SHIPPING.province, 50));
    await fill("zip", SHIPPING.zip) ||
      (await fill("postal", SHIPPING.zip)) ||
      (await fill("postal_code", SHIPPING.zip)) ||
      (await fillInputByPlaceholderOrLabel(page, ["zip", "postal", "postal code"], SHIPPING.zip, 50));
    await fill("phone", SHIPPING.phone) ||
      (await fillInputByPlaceholderOrLabel(page, ["phone", "telephone"], SHIPPING.phone, 50, "email|mobile|optional"));

    const cont2 = await page.$('button[name="commit"], input[name="commit"]');
    if (cont2) await cont2.click();
    await sleep(2000);

    // Shipping method: choose first/cheapest
    const shipOpt = await page.$('input[type="radio"][name*="shipping"]');
    if (shipOpt) await shipOpt.click();
    await sleep(500);
    const cont3 = await page.$('button[name="commit"], input[name="commit"]');
    if (cont3) await cont3.click();
    await sleep(3000);

    // Payment: card in iframe or main page
    try {
      await fillCardInCheckout(page, opts.timeoutMs);
    } catch (err) {
      if (!opts.headless) await saveStepScreenshot(page, opts.runId, "after-card-fill-error", seq);
      throw err;
    }
    await sleep(1000);
    await saveStepScreenshot(page, opts.runId, "after-card-fill", seq);

    await dismissSaveAddressModal(page);
    await sleep(500);
    await saveStepScreenshot(page, opts.runId, "before-pay-button", seq);

    let payBtn = await page.$('button[name="commit"], input[name="commit"]');
    if (!payBtn) {
      const allBtns = await page.$$("button, input[type=submit]");
      for (const b of allBtns) {
        const text = await page.evaluate((el) => el.value || el.textContent || "", b);
        if (/complete|pay now|place order/i.test(text)) {
          payBtn = b;
          break;
        }
      }
    }
    if (payBtn) await payBtn.click();

    await sleep(5000);
    await saveStepScreenshot(page, opts.runId, "after-pay", seq);
    const url = page.url();
    const content = await page.content();

    const isThankYou =
      url.includes("/thank_you") ||
      url.includes("thank-you") ||
      /thank\s*you/i.test(content) ||
      /order\s*confirmed/i.test(content);

    const finalBody = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (/password incorrect|wrong password/i.test(finalBody)) {
      throw new Error("Storefront password rejected. Check STOREFRONT_PASSWORD in .env.local or --storefront-password.");
    }

    if (isThankYou) {
      let orderName = null;
      const match = content.match(/order\s*#?\s*(\d+)/i) || content.match(/#(\d{4,})/);
      if (match) orderName = `#${match[1]}`;
      await browser.close();

      const tagResult = await findOrderByEmailAndTag(
        opts.adminToken,
        shop,
        opts.apiVersion,
        email,
        runId,
        opts.tag,
        seq,
        opts
      );
      results.push({
        seq,
        email,
        orderId: tagResult.orderId ?? null,
        orderName: tagResult.orderName ?? orderName,
        confirmationUrl: url,
        status: tagResult.status,
      });
      return;
    }

    throw new Error("Thank-you page not detected. Payment may have failed or the page structure differs.");
  } catch (err) {
    await saveFailureArtifacts(page, runId, seq);
    results.push({
      seq,
      email,
      orderId: null,
      orderName: null,
      confirmationUrl: null,
      status: "failed",
      error: err.message,
      stack: err.stack,
    });
  } finally {
    await browser.close();
  }
}

// --- Main --------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  assertPreconditions(opts);

  if (!opts.adminToken || opts.adminToken.length === 0) {
    const env = loadEnv();
    try {
      opts.adminToken = await getAdminToken({ shop: opts.shop, env });
    } catch (err) {
      console.error("Could not get Admin API token:", err.message);
      console.error("Ensure DisputeDesk (or your app) is installed on", opts.shop, "and SHOPIFY_CLIENT_ID + SHOPIFY_API_SECRET are in .env.local");
      process.exit(1);
    }
  }

  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch {
    console.error("puppeteer is required. Run: npm install puppeteer");
    process.exit(1);
  }

  console.log("Real dispute generator (test mode)");
  console.log("Shop:", opts.shop, "| Run ID:", opts.runId, "| Count:", opts.count);
  console.log("Card (masked):", CARD_MASK);

  const results = [];
  const startedAt = new Date().toISOString();

  for (let i = 1; i <= opts.count; i++) {
    console.log(`\n--- Order ${i}/${opts.count} ---`);
    await runOneCheckout(opts, i, opts.runId, results, puppeteer);
    if (i < opts.count) await sleep(2000);
  }

  const summary = {
    total: opts.count,
    success: results.filter((r) => r.status === "tagged" || (r.orderName && r.status === "not_found")).length,
    failed: results.filter((r) => r.status === "failed" || (r.status === "not_found" && !r.orderName)).length,
  };

  const payload = {
    runId: opts.runId,
    shop: opts.shop,
    startedAt,
    headless: opts.headless,
    countRequested: opts.count,
    results,
    summary,
  };

  const artifactPath = writeRunArtifact(opts.runId, payload);
  ensureArtifactDir(opts.runId);

  console.log("\n--- Summary ---");
  console.log("Success:", summary.success, "| Failed:", summary.failed);
  results.forEach((r) => {
    if (r.orderId || r.orderName) {
      const note = r.status === "not_found" ? " (checkout ok, tag not found in time)" : "";
      console.log(`  ${r.seq}: ${r.orderName || r.orderId} ${r.email}${note}`);
    } else if (r.status === "failed") console.log(`  ${r.seq}: FAILED - ${r.error}`);
  });
  console.log("Artifacts:", artifactPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
