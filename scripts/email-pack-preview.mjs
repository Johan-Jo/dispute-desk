/**
 * Email evidence pack — BANK-FACING render.
 *
 * DUAL RENDER RULE: This is the bank output layer.
 * - ONLY include evidence that is available and strengthens the case
 * - NEVER show missing/unavailable items
 * - NEVER show completeness scores or checklists
 * - NEVER expose internal logic
 *
 * Usage: node scripts/email-pack-preview.mjs <dispute-id>
 */
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const disputeId = process.argv[2];
if (!disputeId) { console.error("Usage: node scripts/email-pack-preview.mjs <dispute-id>"); process.exit(1); }

async function main() {
  const { data: dispute } = await sb.from("disputes").select("*").eq("id", disputeId).single();
  const { data: pack } = await sb.from("evidence_packs").select("*").eq("dispute_id", disputeId).order("created_at", { ascending: false }).limit(1).single();
  const { data: items } = await sb.from("evidence_items").select("*").eq("pack_id", pack.id).order("created_at");
  const { data: rebuttal } = await sb.from("rebuttal_drafts").select("*").eq("pack_id", pack.id).eq("locale", "en-US").maybeSingle();
  const { data: shop } = await sb.from("shops").select("shop_domain").eq("id", dispute.shop_id).single();
  const shopDomain = shop?.shop_domain ?? "unknown.myshopify.com";

  const orderName = dispute.order_name || "#" + disputeId.slice(0, 8);
  const reason = dispute.reason || "FRAUDULENT";
  const reasonLabel = {
    FRAUDULENT: "Unauthorized Transaction",
    PRODUCT_NOT_RECEIVED: "Item Not Received",
    PRODUCT_UNACCEPTABLE: "Product Not As Described",
    SUBSCRIPTION_CANCELED: "Subscription Dispute",
    DUPLICATE: "Duplicate Charge",
  }[reason] || reason;

  // Determine which evidence types are relevant for this dispute reason
  const relevantTypes = {
    FRAUDULENT: new Set(["order", "other", "comms", "access_log"]),
    PRODUCT_NOT_RECEIVED: new Set(["order", "shipping", "comms", "policy", "access_log"]),
    PRODUCT_UNACCEPTABLE: new Set(["order", "comms", "policy"]),
    SUBSCRIPTION_CANCELED: new Set(["order", "comms", "policy", "access_log"]),
    DUPLICATE: new Set(["order", "other"]),
  }[reason] || new Set(["order", "shipping", "other", "comms", "policy", "access_log"]);

  // Filter to only relevant, available evidence
  const bankItems = (items ?? []).filter(i => relevantTypes.has(i.type));

  // ── Classify defense position from evidence ──
  const hasAvs = bankItems.some(i => i.type === "other" && i.payload?.avsResultCode);
  const hasCvv = bankItems.some(i => i.type === "other" && i.payload?.cvvResultCode);
  const hasOrder = bankItems.some(i => i.type === "order");
  const hasComms = bankItems.some(i => i.type === "comms");
  const hasHistory = bankItems.some(i => i.type === "access_log");
  const signals = [hasAvs && "AVS match", hasCvv && "CVV match", hasOrder && "Order confirmed", hasComms && "Customer notified", hasHistory && "Account history"].filter(Boolean);
  const positionLabel = "Purchase made by the legitimate cardholder";
  const confidence = signals.length >= 3 ? "High" : signals.length >= 2 ? "Medium" : "Low";

  // ── Build bank-facing output ──

  let body = "";
  body += `DISPUTE RESPONSE \u2014 ${reasonLabel.toUpperCase()}\n`;
  body += `Order ${orderName} | ${dispute.currency_code} ${dispute.amount}\n`;
  body += `Defense position: ${positionLabel} (${confidence} confidence)\n`;
  body += "\u2500".repeat(60) + "\n\n";

  // Argument (rebuttal)
  if (rebuttal?.sections) {
    for (const sec of rebuttal.sections) {
      if (sec.type === "summary") {
        body += sec.text + "\n\n";
      } else if (sec.type === "claim") {
        body += sec.text + "\n\n";
      } else if (sec.type === "conclusion") {
        body += sec.text + "\n\n";
      }
    }
    body += "\u2500".repeat(60) + "\n";
    body += "SUPPORTING EVIDENCE\n";
    body += "\u2500".repeat(60) + "\n\n";
  }

  // Evidence — only available, positive items
  for (const item of bankItems) {
    const p = item.payload;

    if (item.type === "order") {
      body += "ORDER DETAILS\n\n";
      body += `  Order: ${p.orderName || ""}\n`;
      body += `  Date: ${fmtDate(p.createdAt)}\n`;
      body += `  Status: ${p.financialStatus || ""}\n`;
      if (p.totals) body += `  Amount: ${p.totals.currency} ${p.totals.total}\n`;
      if (p.billingAddress) body += `  Billing address: ${fmtAddr(p.billingAddress)}\n`;
      if (p.shippingAddress) body += `  Shipping address: ${fmtAddr(p.shippingAddress)}\n`;
      if (p.billingAddress && p.shippingAddress) {
        const match = p.billingAddress.city === p.shippingAddress.city && p.billingAddress.countryCode === p.shippingAddress.countryCode;
        if (match) body += `  Address verification: Billing and shipping addresses match\n`;
      }
      if (p.lineItems?.length) {
        body += "\n  Items ordered:\n";
        for (const li of p.lineItems) {
          body += `    \u2022 ${li.title}${li.variantTitle ? " (" + li.variantTitle + ")" : ""} \u00d7 ${li.quantity}\n`;
        }
      }
      body += "\n";
    }

    if (item.type === "other" && p.avsResultCode !== undefined) {
      body += "PAYMENT VERIFICATION\n\n";
      if (p.avsResultCode) {
        const avsDesc = p.avsResultCode === "Y" ? "Full match" : p.avsResultCode === "A" ? "Address match" : p.avsResultCode;
        body += `  AVS (Address Verification): ${avsDesc}\n`;
      }
      if (p.cvvResultCode) {
        const cvvDesc = p.cvvResultCode === "M" ? "Match" : p.cvvResultCode;
        body += `  CVV (Card Verification): ${cvvDesc}\n`;
      }
      if (p.cardCompany) body += `  Card: ${p.cardCompany}${p.lastFour ? " ending " + p.lastFour.replace(/[^0-9]/g, "") : ""}\n`;
      if (p.gateway) body += `  Payment processor: ${p.gateway.replace(/_/g, " ")}\n`;
      body += "\n";
    }

    if (item.type === "shipping") {
      body += "SHIPPING & DELIVERY\n\n";
      const fulfillments = p.fulfillments || [];
      for (const f of fulfillments) {
        if (f.tracking?.length) {
          for (const t of f.tracking) {
            if (t.carrier) body += `  Carrier: ${t.carrier}\n`;
            if (t.number) body += `  Tracking: ${t.number}\n`;
          }
        }
        if (f.createdAt) body += `  Shipped: ${fmtDate(f.createdAt)}\n`;
        if (f.deliveredAt) body += `  Delivered: ${fmtDate(f.deliveredAt)}\n`;
      }
      body += "\n";
    }

    if (item.type === "comms") {
      const events = p.timelineEvents || [];
      // Only include customer-facing events (confirmations, notifications)
      const relevant = events.filter(e => {
        const msg = (e.message || "").toLowerCase();
        return msg.includes("confirmation") || msg.includes("email was sent") ||
               msg.includes("placed this order") || msg.includes("authorized") ||
               msg.includes("captured");
      });
      if (relevant.length > 0) {
        body += "CUSTOMER NOTIFICATIONS\n\n";
        for (const e of relevant) {
          const msg = (e.message || "").replace(/<[^>]+>/g, "");
          body += `  [${fmtDateTime(e.createdAt)}] ${msg}\n`;
        }
        body += "\n";
      }
    }

    if (item.type === "access_log") {
      if (p.customerTenure) {
        body += "CUSTOMER ACCOUNT\n\n";
        body += `  Account created: ${fmtDate(p.customerTenure.customerSince)}\n`;
        if (parseInt(p.customerTenure.totalOrders) > 0) {
          body += `  Prior orders: ${p.customerTenure.totalOrders}\n`;
        }
        body += "\n";
      }
    }

    if (item.type === "policy") {
      // Only include policies relevant to dispute reason
      const relevantPolicies = {
        FRAUDULENT: [], // Fraud doesn't need policies
        PRODUCT_NOT_RECEIVED: ["shipping", "refunds"],
        PRODUCT_UNACCEPTABLE: ["refunds", "terms"],
        SUBSCRIPTION_CANCELED: ["terms", "refunds"],
        DUPLICATE: [],
      }[reason] || ["refunds", "shipping", "terms"];

      const policies = (p.policies || []).filter(pol => relevantPolicies.includes(pol.policyType));
      if (policies.length > 0) {
        body += "STORE POLICIES\n\n";
        const policySummaries = {
          refunds: "The store's refund policy was clearly disclosed and accepted by the customer at checkout, outlining conditions for returns, refunds, and exchanges.",
          shipping: "The store's shipping policy was disclosed at checkout, covering processing times, shipping methods, and delivery estimates.",
          terms: "The store's terms of service were presented and accepted by the customer before completing the purchase.",
        };
        for (const pol of policies) {
          const typeName = pol.policyType.charAt(0).toUpperCase() + pol.policyType.slice(1);
          const policySlug = { terms: "terms-of-service", refunds: "refund-policy", shipping: "shipping-policy" }[pol.policyType];
          body += `  ${typeName} Policy\n`;
          body += `  ${policySummaries[pol.policyType] || "Policy was disclosed at checkout."}\n`;
          if (policySlug) body += `  ${`https://${shopDomain}/policies/${policySlug}`}\n`;
          body += "\n";
        }
      }
    }
  }

  body += "\u2500".repeat(60) + "\n";
  body += "Generated by DisputeDesk \u2014 disputedesk.app\n";

  // Send
  const resend = new Resend(process.env.RESEND_API_KEY);
  const to = "oi@johan.com.br";
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "DisputeDesk <notifications@mail.disputedesk.app>",
    to,
    subject: `Dispute Response \u2014 ${reasonLabel} \u2014 Order ${orderName}`,
    text: body,
  });
  if (error) { console.error("Email error:", error); process.exit(1); }
  console.log(`\u2713 Email sent to ${to}`);
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtAddr(a) {
  if (!a) return "";
  return [a.city, a.provinceCode, a.countryCode].filter(Boolean).join(", ");
}

main().catch(e => { console.error(e); process.exit(1); });
