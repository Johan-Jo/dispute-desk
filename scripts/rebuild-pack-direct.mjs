/**
 * Rebuild pack by directly fetching Shopify data and inserting evidence.
 * Bypasses the job runner to use the local encryption keys.
 *
 * Usage: node scripts/rebuild-pack-direct.mjs <dispute-id>
 */
import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "crypto";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const ALGO = "aes-256-gcm";
const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function decryptToken(raw) {
  const p = raw.split(":");
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY_V1 || process.env.TOKEN_ENCRYPTION_KEY;
  const key = Buffer.from(keyHex, "hex");
  const d = createDecipheriv(ALGO, key, Buffer.from(p[1], "hex"));
  d.setAuthTag(Buffer.from(p[2], "hex"));
  return Buffer.concat([d.update(Buffer.from(p[3], "hex")), d.final()]).toString("utf8");
}

const ORDER_QUERY = `query($id: ID!) {
  node(id: $id) {
    ... on Order {
      id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus note
      totalPriceSet { shopMoney { amount currencyCode } }
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } }
      totalDiscountsSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
      billingAddress { city provinceCode countryCode zip }
      shippingAddress { city provinceCode countryCode zip }
      lineItems(first: 50) { edges { node { title variantTitle quantity originalTotalSet { shopMoney { amount currencyCode } } sku } } }
      fulfillments(first: 20) { id status displayStatus createdAt updatedAt deliveredAt estimatedDeliveryAt trackingInfo(first: 10) { number url company } fulfillmentLineItems(first: 50) { edges { node { lineItem { title } quantity } } } }
      refunds(first: 10) { id createdAt note totalRefundedSet { shopMoney { amount currencyCode } } }
      transactions(first: 10) { id kind status gateway paymentDetails { __typename ... on CardPaymentDetails { avsResultCode cvvResultCode bin company number name expirationMonth expirationYear wallet } } }
      events(first: 30) { edges { node { id message createdAt attributeToUser attributeToApp criticalAlert } } }
      customer { numberOfOrders createdAt note }
    }
  }
}`;

const disputeId = process.argv[2];
if (!disputeId) { console.error("Usage: node scripts/rebuild-pack-direct.mjs <dispute-id>"); process.exit(1); }

async function main() {
  const { data: dispute } = await sb.from("disputes").select("order_gid, reason, shop_id").eq("id", disputeId).single();
  if (!dispute) { console.error("Dispute not found"); process.exit(1); }

  const { data: pack } = await sb.from("evidence_packs").select("id, pack_template_id").eq("dispute_id", disputeId).order("created_at", { ascending: false }).limit(1).single();
  if (!pack) { console.error("No pack found"); process.exit(1); }
  const packId = pack.id;

  const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", dispute.shop_id).single();
  const { data: session } = await sb.from("shop_sessions").select("access_token_encrypted").eq("shop_id", dispute.shop_id).eq("session_type", "offline").is("user_id", null).order("created_at", { ascending: false }).limit(1).single();

  const token = decryptToken(session.access_token_encrypted);
  console.log("Token decrypted, fetching order", dispute.order_gid);

  const res = await fetch("https://" + shop.shop_domain + "/admin/api/2026-01/graphql.json", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query: ORDER_QUERY, variables: { id: dispute.order_gid } }),
  });
  const { data: gql } = await res.json();
  const order = gql?.node;
  if (!order) { console.error("Order fetch failed"); process.exit(1); }

  console.log("Order:", order.name, order.displayFinancialStatus, order.displayFulfillmentStatus);

  const collectedFields = new Set();
  const items = [];

  // Order source
  const lineItems = (order.lineItems?.edges ?? []).map(e => ({
    title: e.node.title, variantTitle: e.node.variantTitle, quantity: e.node.quantity,
    total: e.node.originalTotalSet?.shopMoney?.amount, currency: e.node.originalTotalSet?.shopMoney?.currencyCode,
  }));
  items.push({ type: "order", label: "Order " + order.name, source: "shopify_order", payload: {
    orderName: order.name, createdAt: order.createdAt,
    financialStatus: order.displayFinancialStatus, fulfillmentStatus: order.displayFulfillmentStatus,
    lineItems,
    totals: {
      subtotal: order.subtotalPriceSet.shopMoney.amount,
      shipping: order.totalShippingPriceSet.shopMoney.amount,
      tax: order.totalTaxSet.shopMoney.amount,
      discounts: order.totalDiscountsSet.shopMoney.amount,
      total: order.totalPriceSet.shopMoney.amount,
      refunded: order.totalRefundedSet.shopMoney.amount,
      currency: order.totalPriceSet.shopMoney.currencyCode,
    },
    billingAddress: order.billingAddress, shippingAddress: order.shippingAddress,
    customerTenure: order.customer ? { totalOrders: order.customer.numberOfOrders, customerSince: order.customer.createdAt } : null,
  }});
  collectedFields.add("order_confirmation");
  if (order.billingAddress && order.shippingAddress &&
      order.billingAddress.city === order.shippingAddress.city &&
      order.billingAddress.countryCode === order.shippingAddress.countryCode) {
    collectedFields.add("billing_address_match");
  }

  // Payment source
  const cardTx = (order.transactions ?? []).find(t =>
    (t.kind === "SALE" || t.kind === "AUTHORIZATION") && t.status === "SUCCESS" &&
    t.paymentDetails?.__typename === "CardPaymentDetails"
  );
  if (cardTx) {
    const pd = cardTx.paymentDetails;
    items.push({ type: "other", label: "Payment Verification (AVS/CVV)", source: "shopify_transactions", payload: {
      avsCvvStatus: (pd.avsResultCode || pd.cvvResultCode) ? "available" : "unavailable_from_gateway",
      avsResultCode: pd.avsResultCode, cvvResultCode: pd.cvvResultCode,
      bin: pd.bin, cardCompany: pd.company, lastFour: pd.number,
      cardholderName: pd.name, wallet: pd.wallet, gateway: cardTx.gateway,
    }});
    if (pd.avsResultCode || pd.cvvResultCode) collectedFields.add("avs_cvv_match");
  }

  // Fulfillment source
  const fulfillments = order.fulfillments ?? [];
  if (fulfillments.length > 0) {
    items.push({ type: "shipping", label: "Shipping & Tracking", source: "shopify_fulfillment", payload: {
      fulfillmentCount: fulfillments.length,
      fulfillments: fulfillments.map(f => ({
        status: f.status, displayStatus: f.displayStatus, deliveredAt: f.deliveredAt,
        createdAt: f.createdAt, estimatedDeliveryAt: f.estimatedDeliveryAt,
        tracking: (f.trackingInfo ?? []).map(t => ({ number: t.number, url: t.url, carrier: t.company })),
        items: (f.fulfillmentLineItems?.edges ?? []).map(e => ({ title: e.node.lineItem.title, quantity: e.node.quantity })),
      })),
    }});
    collectedFields.add("shipping_tracking");
    if (fulfillments.some(f => f.deliveredAt)) collectedFields.add("delivery_proof");
  }

  // Customer comms
  const events = (order.events?.edges ?? []).map(e => e.node);
  if (order.note || order.customer?.note || events.length > 0) {
    items.push({ type: "comms", label: "Customer communication", source: "shopify_timeline", payload: {
      orderNote: order.note, customerNote: order.customer?.note,
      timelineEvents: events.slice(0, 15).map(e => ({ message: e.message, createdAt: e.createdAt })),
      summary: { timelineEventCount: events.length },
    }});
    collectedFields.add("customer_communication");
  }

  // Activity log
  if (order.customer || events.length > 0) {
    items.push({ type: "access_log", label: "Customer activity log", source: "shopify_order", payload: {
      customerTenure: order.customer ? { totalOrders: order.customer.numberOfOrders, customerSince: order.customer.createdAt, customerNote: order.customer.note } : null,
      timelineEvents: events.slice(0, 20).map(e => ({ message: e.message, createdAt: e.createdAt })),
      timelineEventCount: events.length,
    }});
    collectedFields.add("activity_log");
  }

  console.log("\nCollected fields:", [...collectedFields].join(", "));
  console.log("Evidence items:", items.length);

  // Clear and reinsert
  await sb.from("evidence_items").delete().eq("pack_id", packId);
  for (const item of items) {
    await sb.from("evidence_items").insert({ pack_id: packId, type: item.type, label: item.label, source: item.source, payload: item.payload });
    console.log("  Inserted:", item.type, "-", item.label);
  }

  // Also insert policies (from policy_snapshots)
  const { data: policies } = await sb.from("policy_snapshots").select("id, policy_type, url, captured_at, content_hash, body_text").eq("shop_id", dispute.shop_id).order("captured_at", { ascending: false });
  if (policies?.length) {
    const byType = new Map();
    for (const p of policies) { if (!byType.has(p.policy_type)) byType.set(p.policy_type, p); }
    const policyData = [...byType.values()].map(p => ({
      policySnapshotId: p.id, policyType: p.policy_type, url: p.url, capturedAt: p.captured_at,
      contentHash: p.content_hash, textPreview: p.body_text?.slice(0, 500) ?? null, textLength: p.body_text?.length ?? 0,
    }));
    const policyFields = [];
    for (const p of policyData) {
      if (p.policyType === "shipping") { collectedFields.add("shipping_policy"); policyFields.push("shipping_policy"); }
      if (p.policyType === "refunds") { collectedFields.add("refund_policy"); policyFields.push("refund_policy"); }
      if (p.policyType === "terms") { collectedFields.add("cancellation_policy"); policyFields.push("cancellation_policy"); }
    }
    await sb.from("evidence_items").insert({ pack_id: packId, type: "policy", label: "Store Policies (" + policyData.length + ")", source: "policy_snapshots", payload: { policies: policyData } });
    console.log("  Inserted: policy - Store Policies (" + policyData.length + ")");
  }

  // Build checklist
  const { data: templateSecs } = await sb.from("pack_template_sections").select("pack_template_items(key, label_default, required, collector_key)").eq("template_id", pack.pack_template_id);
  const templateItems = [];
  for (const sec of templateSecs ?? []) for (const item of sec.pack_template_items ?? []) templateItems.push(item);

  const isFulfilled = order.displayFulfillmentStatus !== "UNFULFILLED";
  const hasCard = !!cardTx;

  const checklistV2 = templateItems.map(t => {
    const field = t.collector_key ?? t.key;
    const present = t.collector_key ? collectedFields.has(t.collector_key) : false;
    const isShippingField = ["shipping_tracking", "delivery_proof"].includes(field);
    const isCardField = field === "avs_cvv_match";
    let status = present ? "available" : "missing";
    let collectionType = "auto";
    if (isShippingField && !isFulfilled) { status = present ? "available" : "unavailable"; collectionType = "conditional_auto"; }
    if (isCardField && !hasCard) { status = "unavailable"; collectionType = "conditional_auto"; }
    if (isCardField && hasCard) collectionType = "conditional_auto";
    if (!t.collector_key) collectionType = "manual";
    return { field, label: t.label_default, status, priority: t.required ? "critical" : "recommended", blocking: false, source: "auto_shopify", collectionType };
  });

  const checklist = templateItems.map(t => {
    const field = t.collector_key ?? t.key;
    const present = t.collector_key ? collectedFields.has(t.collector_key) : false;
    return { field, label: t.label_default, required: t.required, present };
  });

  const score = checklist.length > 0 ? Math.round(checklist.filter(c => c.present).length / checklist.length * 100) : 0;
  const missingCritical = checklistV2.filter(c => c.priority === "critical" && c.status === "missing").length;
  const readiness = missingCritical > 0 ? "ready_with_warnings" : "ready";

  await sb.from("evidence_packs").update({
    status: "ready", completeness_score: score, checklist, checklist_v2: checklistV2,
    blockers: checklist.filter(c => c.required && !c.present).map(c => c.label),
    submission_readiness: readiness, updated_at: new Date().toISOString(),
  }).eq("id", packId);

  // Clear argument map so it regenerates
  await sb.from("argument_maps").delete().eq("pack_id", packId);

  console.log("\nDone. Score:", score + "%", "Readiness:", readiness);
  console.log("\nChecklist v2:");
  for (const c of checklistV2) {
    const icon = c.status === "available" ? "✓" : c.status === "unavailable" ? "—" : "✗";
    console.log(" ", icon, c.status.padEnd(12), c.field, "-", c.label);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
